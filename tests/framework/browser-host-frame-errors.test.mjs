import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
// Use the installed Three r112 scheduler itself: it requests the next native
// frame AFTER the application callback. A leaked exception really loses RAF.
const animationSource=fs.readFileSync(new URL('../../node_modules/three/src/renderers/webgl/WebGLAnimation.js',import.meta.url),'utf8').replace(/^export .*;\r?$/gm,'');
const WebGLAnimation=new Function(animationSource+'\nreturn WebGLAnimation;')();
const hostSource=fs.readFileSync(new URL('../../packages/render-three/BrowserHost.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
class Element{
 constructor(){this.listeners=new Map();this.children=[];this.clientWidth=800;this.clientHeight=600;}
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
 removeEventListener(name,fn){if(this.listeners.has(name))this.listeners.get(name).delete(fn);}
 setAttribute(){}appendChild(child){child.parent=this;this.children.push(child);}remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
}
function fixture(options={}){
 const pending=[],window=new Element(),document={hidden:false},container=new Element(),events=[],native={requestAnimationFrame(fn){pending.push(fn);}};
 class Renderer{
  constructor(){this.domElement=new Element();this.shadowMap={};this.xr={getSession:()=>null};this.renders=0;this.renderAttempts=0;this.animation=WebGLAnimation();this.animation.setContext(native);}
  setSize(){}setAnimationLoop(fn){this.animation.setAnimationLoop(fn);if(fn)this.animation.start();else this.animation.stop();}
  render(){this.renderAttempts++;if(this.renderFault)throw this.renderFault;this.renders++;}dispose(){this.disposed=true;}
 }
 class Input{constructor(){this.steps=0;this.resets=0;}step(){this.steps++;if(this.fault)throw this.fault;}reset(){this.resets++;}dispose(){this.disposed=true;}}
 class Graphics{constructor(){this.ticks=0;}setViewport(){}tick(){this.ticks++;if(this.fault)throw this.fault;}dispose(){this.disposed=true;}}
 const create=new Function('THREE','AdaptiveGraphics','VRButton','BrowserInput','window','document',hostSource+'\nreturn createBrowserHost;')({...THREE,WebGLRenderer:Renderer},Graphics,{},Input,window,document);
 const host=create({container,onFrameError:event=>events.push(event),...options}),ctx=host.context;let time=0;
 return{host,ctx,events,pending,container,window,pump(){assert.equal(pending.length,1,'The real scheduler must have exactly one pending RAF.');const callback=pending.shift();time+=16;assert.doesNotThrow(()=>callback(time));return host.stats();}};
}

test('a thrown before callback keeps real native RAF/input/render alive and latches simulation until explicit recovery',async()=>{
 const f=fixture(),counts={before:0,after:0,begin:0,end:0},error=Error('Invalid carried-product transform');
 f.ctx.collisionWorld={beginFrame(){counts.begin++;},endFrame(){counts.end++;}};
 f.host.setFrameHandler({before(){counts.before++;throw error;},after(){counts.after++;}});f.host.start();
 for(let i=0;i<5;i++)f.pump();
 assert.equal(f.events.length,1);assert.equal(f.events[0].error,error);assert.equal(f.events[0].phase,'before');assert(f.events[0].simulationBlocked);assert(Object.isFrozen(f.events[0]));assert.equal(counts.before,1);assert.equal(counts.after,5);assert.equal(f.ctx.input.steps,5);assert.equal(f.ctx.renderer.renders,5);assert.equal(counts.begin,5);assert.equal(counts.end,5);assert.equal(f.ctx.input.resets,1);assert.equal(f.host.stats().skippedSimulationFrames,4);assert.equal(f.host.stats().frameError.message,error.message);assert.doesNotThrow(()=>JSON.stringify(f.host.stats()));
 f.host.setFrameHandler({before({delta}){counts.before++;assert.equal(delta,0,'Explicit recovery discards accumulated stalled time.');}});f.pump();assert.equal(counts.before,1,'Replacing a handler never silently clears a simulation fault.');const previous=f.host.clearFrameError();assert.equal(previous.phase,'before');f.pump();assert.equal(counts.before,2);assert.equal(f.host.stats().frameError,null);assert.equal(f.events.length,1);await f.host.dispose();
});

test('render failures retry drawing without log spam or silently resuming simulation, while after/end cleanup continues',async()=>{
 const f=fixture(),counts={before:0,after:0,end:0};f.ctx.collisionWorld={endFrame(){counts.end++;}};f.ctx.renderer.renderFault=Error('GPU draw failed');f.host.setFrameHandler({before(){counts.before++;},after(){counts.after++;}});f.host.start();
 for(let i=0;i<4;i++)f.pump();assert.equal(f.events.length,1);assert.equal(f.host.stats().frameError.phase,'render');assert.equal(f.host.stats().frameErrors,4);assert.equal(f.host.stats().failedFrames,4);assert.equal(counts.before,1);assert.equal(counts.after,4);assert.equal(counts.end,4);assert.equal(f.ctx.renderer.renderAttempts,4);assert.equal(f.ctx.renderer.renders,0);
 f.ctx.renderer.renderFault=null;f.pump();assert.equal(f.ctx.renderer.renders,1);assert.equal(counts.before,1);assert(f.host.stats().frameError,'Successful drawing alone does not repair a failed application step.');f.host.clearFrameError();f.pump();assert.equal(counts.before,2);assert.equal(f.ctx.renderer.renders,2);assert.equal(f.events.length,1);await f.host.dispose();
});

test('graphics, input gates, input, matrix, after and collision failures cannot break native scheduling or skip cleanup',async()=>{
 for(const phase of ['graphics','inputGate','input','matrices','after','collision.begin','collision.end']){
  let gateFault=phase==='inputGate';const f=fixture({inputBlocked:()=>{if(gateFault)throw Error('input gate failed');return false;}}),counts={before:0,after:0,begin:0,end:0},fault=Error(phase+' failed');
  if(phase==='graphics')f.ctx.graphics.fault=fault;if(phase==='input')f.ctx.input.fault=fault;
  const update=f.ctx.scene.updateMatrixWorld.bind(f.ctx.scene);if(phase==='matrices')f.ctx.scene.updateMatrixWorld=()=>{throw fault;};
  f.ctx.collisionWorld={beginFrame(){counts.begin++;if(phase==='collision.begin')throw fault;},endFrame(){counts.end++;if(phase==='collision.end')throw fault;}};
  f.host.setFrameHandler({before(){counts.before++;},after(){counts.after++;if(phase==='after')throw fault;}});f.host.start();for(let i=0;i<3;i++)f.pump();
  assert.equal(f.events.length,1,phase);assert.equal(f.host.stats().frameError.phase,phase==='inputGate'?'input':phase);assert.equal(f.host.stats().failedFrames,3);assert.equal(counts.begin,3);assert.equal(counts.end,3,'endFrame still runs after '+phase);assert.equal(counts.after,3);assert(counts.before<=1,phase+' must block subsequent simulation callbacks');assert.equal(f.ctx.renderer.renders,phase==='matrices'?0:3,'Invalid matrices are never drawn; other phases retain rendering.');assert.equal(f.pending.length,1);
  gateFault=false;f.ctx.scene.updateMatrixWorld=update;await f.host.dispose();
 }
});

test('a faulty error observer is contained and a fresh incident can notify again only after explicit clear',async()=>{
 let observed=0;const f=fixture({onFrameError(){observed++;throw Error('Observer failed');}});f.host.setFrameHandler({before(){throw Error('First incident');}});f.host.start();f.pump();f.pump();assert.equal(observed,1);assert.equal(f.host.stats().notificationErrors,1);assert.equal(f.ctx.renderer.renders,2);f.host.clearFrameError();f.pump();assert.equal(observed,2);assert.equal(f.host.stats().notificationErrors,2);assert.equal(f.ctx.renderer.renders,3);await f.host.dispose();
});

test('default consumers receive one visible fault notification and disposal retires the real RAF and resources',async()=>{
 const notices=[],f=fixture({onFrameError:undefined,notify:text=>notices.push(text)});let ended=0;f.ctx.collisionWorld={beginFrame(){},endFrame(){ended++;}};f.host.setFrameHandler({before(){throw Error('Cannot continue safely');}});f.host.start();f.pump();f.pump();assert.equal(notices.length,1);assert(notices[0].includes('Cannot continue safely'));assert.equal(ended,2);assert.equal(f.host.stats().frameAttempts,2);
 await f.host.dispose();assert(f.ctx.renderer.disposed&&f.ctx.input.disposed&&f.ctx.graphics.disposed);assert.equal(f.container.children.length,0);const scheduled=f.pending.shift();assert.doesNotThrow(()=>scheduled(48));assert.equal(f.pending.length,0,'The real Three scheduler retires the already queued callback after stop.');assert.equal(ended,2);assert.equal([...f.window.listeners.values()].reduce((sum,list)=>sum+list.size,0),0);assert.throws(()=>f.host.clearFrameError(),/disposed/);
});
