'use strict';
// Real compiled application, r112 PositionalAudio and native RayControl events.
// Only delivery of the actual spray decoder callback is held for the race.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {startTemporaryServer}=require('./qa-project-workspace-browser'),{withBrowser}=require('./qa-public-publication-browser');
const ROOT=path.resolve(__dirname,'..'),OUTPUT=path.join(ROOT,'data/qa-studio');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
async function run(){
 const expected=arg('--expected-bundle-sha256');assert(expected&&/^[a-f0-9]{64}$/.test(expected));assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'bundle.js'))).digest('hex'),expected);
 const spray=fs.readFileSync(path.join(ROOT,'assets/ogg/spray.ogg'));fs.mkdirSync(OUTPUT,{recursive:true});
 const fixture=await startTemporaryServer(),report={bundleSha256:expected,nativeControllerLifecycle:true,physicalHeadsetTested:false};
 try{
  await withBrowser(fixture.origin,async b=>{
   try{
    await b.navigate('/?scene=vr-robot-dispatch');await b.until(()=>b.evaluate('!context.roomTransition&&!context.editor.loadingProject&&context.editor.simulation.running'),'Public scene did not settle.');
    report.pending=await b.call(async signature=>{
     const T=await import('/node_modules/three/build/three.module.js'),ray=context.raycontrol,audio=context.audioListener.context,decode=audio.decodeAudioData;
     const qa=window.__graffitiNativeQA={ray,audio,decode,jobs:[],initialControllerCount:ray.controllers.length};
     audio.decodeAudioData=function(data,done,failed){const prefix=new Uint8Array(data,0,Math.min(data.byteLength,signature.prefix.length)),match=data.byteLength===signature.bytes&&signature.prefix.every((value,i)=>prefix[i]===value);if(!match||typeof done!=='function')return decode.call(this,data,done,failed);return decode.call(this,data,buffer=>qa.jobs.push({buffer,deliver:()=>done(buffer)}),failed);};
     const controller=qa.controller=new T.Group();controller.name='QA native graffiti input';controller.position.set(100,100,100);controller.boundingBox=new T.Box3(new T.Vector3(99,99,99),new T.Vector3(101,101,101));const model=new T.Group();model.name='Scene';controller.add(model);context.scene.add(controller);
     qa.source=()=>({handedness:ray.primary||'right',targetRayMode:'tracked-pointer',gripSpace:{},gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:Array.from({length:6},()=>({pressed:false,value:0}))}});
     qa.watch=sound=>{const stats={setBuffers:0,pannerDisconnects:0,gainDisconnects:0};for(const [key,field]of[['panner','pannerDisconnects'],['gain','gainDisconnects']]){const node=sound[key],native=node.disconnect;node.disconnect=function(...args){stats[field]++;return native.apply(this,args);};}const setBuffer=sound.setBuffer;sound.setBuffer=function(value){stats.setBuffers++;return setBuffer.call(this,value);};return stats;};
     qa.first=ray.addController(controller,qa.source());qa.firstSound=controller.getObjectByName('spraySound');if(!qa.firstSound)throw Error('Production Graffiti did not bind the primary native controller.');qa.firstStats=qa.watch(qa.firstSound);
     return {sourceUndefined:qa.firstSound.source===undefined,bufferPending:qa.firstSound.buffer===null,controllerCount:ray.controllers.length};
    },{bytes:spray.length,prefix:Array.from(spray.subarray(0,32))});
    assert(report.pending.sourceUndefined&&report.pending.bufferPending);
    await b.until(()=>b.evaluate('__graffitiNativeQA.jobs.length>=1'),'The real spray audio did not decode.',30000);
    report.reconnected=await b.call(()=>{const q=__graffitiNativeQA;q.ray.removeController(q.controller);q.second=q.ray.addController(q.controller,q.source());q.secondSound=q.controller.getObjectByName('spraySound');q.secondStats=q.watch(q.secondSound);return {firstDetached:q.firstSound.parent===null,firstSourceCleared:q.firstSound.source===null,firstBufferCleared:q.firstSound.buffer===null,firstGraph:q.firstStats,singleSound:q.controller.children.filter(child=>child.name==='spraySound').length,distinctSound:q.secondSound!==q.firstSound};});
    assert(report.reconnected.firstDetached&&report.reconnected.firstSourceCleared&&report.reconnected.firstBufferCleared&&report.reconnected.distinctSound);assert.equal(report.reconnected.singleSound,1);assert.deepEqual(report.reconnected.firstGraph,{setBuffers:0,pannerDisconnects:1,gainDisconnects:1});
    await b.until(()=>b.evaluate('__graffitiNativeQA.jobs.length>=2'),'The reconnected spray audio did not decode.',30000);
    report.race=await b.call(()=>{const q=__graffitiNativeQA;q.jobs[1].deliver();q.jobs[0].deliver();return {oldIgnored:q.firstSound.buffer===null&&q.firstStats.setBuffers===0,currentBuffer:q.secondSound.buffer===q.jobs[1].buffer,currentAssignments:q.secondStats.setBuffers,notAutoPlaying:!q.secondSound.isPlaying};});
    assert(report.race.oldIgnored&&report.race.currentBuffer&&report.race.notAutoPlaying);assert.equal(report.race.currentAssignments,1);
    report.cleanup=await b.call(()=>{const q=__graffitiNativeQA;q.secondSound.play();const source=q.secondSound.source,disconnect=source.disconnect,stop=source.stop,sourceStats={disconnects:0,stops:0};source.disconnect=function(...args){sourceStats.disconnects++;return disconnect.apply(this,args);};source.stop=function(...args){sourceStats.stops++;return stop.apply(this,args);};q.ray.removeController(q.controller);q.ray.removeController(q.controller);context.scene.remove(q.controller);q.audio.decodeAudioData=q.decode;return {nativeRemoveSucceeded:true,sourceStats,graph:q.secondStats,sourceCleared:q.secondSound.source===null,bufferCleared:q.secondSound.buffer===null,callbackCleared:source.onended===null,noTool:q.controller.children.every(child=>!['spray','spraySound','ColorWheel'].includes(child.name)),controllerCount:q.ray.controllers.length,initialControllerCount:q.initialControllerCount,gl:context.renderer.getContext().getError()};});
    assert.deepEqual(report.cleanup.sourceStats,{disconnects:1,stops:1});assert.deepEqual(report.cleanup.graph,{setBuffers:1,pannerDisconnects:1,gainDisconnects:1});assert(report.cleanup.sourceCleared&&report.cleanup.bufferCleared&&report.cleanup.callbackCleared&&report.cleanup.noTool);assert.equal(report.cleanup.controllerCount,report.cleanup.initialControllerCount);assert.equal(report.cleanup.gl,0);
    await b.screenshot('native-graffiti-controller-lifecycle');assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(b.report.apiFailures,[]);assert.deepEqual(b.report.writes,[]);
   }finally{report.browser={exceptions:b.report.exceptions,consoleErrors:b.report.consoleErrors,apiFailures:b.report.apiFailures,writes:b.report.writes,shots:b.report.shots};await b.call(()=>{const q=window.__graffitiNativeQA;if(q)q.audio.decodeAudioData=q.decode;}).catch(()=>{});}
  });
  assert.deepEqual(fixture.errors,[]);console.log('PASS native Graffiti add/remove/reconnect: actual decoded audio, stale completion ignored, exact WebAudio graph release, GL0 and no browser errors.');
 }catch(error){report.failure=error.stack;throw error;}finally{fs.writeFileSync(path.join(OUTPUT,'native-graffiti-browser.json'),JSON.stringify(report,null,2));await fixture.close();}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
