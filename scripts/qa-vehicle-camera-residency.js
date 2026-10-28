'use strict';
// Anonymous production lesson, isolated Pages package and Chrome. Pixel reads
// are QA only; the application's camera feed stays entirely on the GPU.
const assert = require('node:assert/strict'), fs = require('node:fs');
const {startStaticServer, withBrowser} = require('./qa-public-publication-browser');
async function run() {
  const fixture = await startStaticServer();
  try {await withBrowser(fixture.origin, async b => {
    await b.navigate('/?scene=forklift-training'); await b.send('Page.bringToFront');
    await b.until(() => b.call(() => !context.roomTransition && !context.roomTransitionView.active && !context.editor.loadingProject && context.editor.simulation.running), 'Training scene did not settle.', 180000);
    await b.call(() => {
      const e=context.editor, record=[...e.simulation.records.values()].find(r=>r.components.vehicle);
      const graphics=context.graphics; graphics.setMode('balanced');graphics.tier=1;graphics.tick=()=>graphics.getStats();graphics.applyDesktopRatio();
      if (!e.vehicleDriving.mount(record.id)) throw Error('Cannot mount training vehicle.');
      const feed=e.vehicleDriving.docking.forkCamera;
      window.__cameraQA={disposed:0,targetsReleased:0};
      window.__cameraSample=()=>{
        const t=feed.target, r=context.renderer, pixels=new Uint8Array(t.width*t.height*4);
        r.readRenderTargetPixels(t,0,0,t.width,t.height,pixels);
        let bright=0,min=255,max=0,total=0;for(let i=0;i<pixels.length;i+=4){const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;if(v>12)bright++;min=Math.min(min,v);max=Math.max(max,v);total+=v;}
        return {bright,mean:total/(t.width*t.height),min,max,frames:feed.stats.frames,disposed:__cameraQA.disposed,status:feed.stats.status,mode:feed.mode,gl:r.getContext().getError(),registered:!!context.performanceRenderTargets?.has?.(t)};
      };
      feed.renderBefore(e.hooks.renderScene,1); feed.target.texture.addEventListener('dispose',()=>__cameraQA.disposed++);
      feed.target.addEventListener('dispose',()=>__cameraQA.targetsReleased++);
      return true;
    });
    b.report.samples=[];
    for(const mode of ['entry','tips']) for(const side of [-1,1]) {
      const sample=await b.call((mode,side)=>{
        const e=context.editor, feed=e.vehicleDriving.docking.forkCamera;
        feed.setMode(mode);feed.side=side;feed.elapsed=Infinity;
        feed.renderBefore(e.hooks.renderScene,1);
        const before=__cameraSample();
        for(let i=0;i<3;i++)e.performance.reconcile();
        const afterEviction=__cameraSample();
        feed.renderBefore(e.hooks.renderScene,1);
        const afterRender=__cameraSample();
        context.renderer.render(e.hooks.renderScene,context.camera);feed.postRender();
        const r=context.renderer, gl=r.getContext(), view=feed.element.getBoundingClientRect(), canvas=r.domElement.getBoundingClientRect(), pixel=new Uint8Array(4);
        let bright=0,min=255,max=0;
        for(let y=1;y<8;y++)for(let x=1;x<12;x++){
          const px=Math.floor((view.left-canvas.left+view.width*x/12)*r.domElement.width/canvas.width);
          const py=Math.floor((canvas.height-(view.top-canvas.top+view.height*y/8))*r.domElement.height/canvas.height);
          gl.readPixels(px,py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          const v=(pixel[0]+pixel[1]+pixel[2])/3;if(v>12)bright++;min=Math.min(min,v);max=Math.max(max,v);
        }
        return {mode,side,before,afterEviction,afterRender,onscreen:{bright,min,max,gl:gl.getError()}};
      },mode,side);
      b.report.samples.push(sample);
      fs.writeFileSync('data/qa-studio/vehicle-camera-residency.json',JSON.stringify(b.report,null,2));
      console.log(JSON.stringify(sample));
      assert.equal(sample.afterRender.disposed,0,'Memory reclamation disposed the active camera texture.');
      for(const state of [sample.before,sample.afterEviction,sample.afterRender]) {assert.equal(state.gl,0);assert(state.bright>100 && state.max-state.min>10,'Camera must contain a real nonblack world image.');}
      assert.equal(sample.onscreen.gl,0);assert(sample.onscreen.bright>20 && sample.onscreen.max-sample.onscreen.min>10,'The visible camera panel must show the GPU image, not a black quad.');
    }
    await b.screenshot('fork-camera-residency');
    b.report.cleanup=await b.call(()=>{const e=context.editor,feed=e.vehicleDriving.docking.forkCamera;feed.setEnabled(false);e.performance.reconcile();return{registered:context.performanceRenderTargets?.size||0,target:!!feed.target,disposed:__cameraQA.disposed,targetsReleased:__cameraQA.targetsReleased};});
    assert.equal(b.report.cleanup.registered,0);assert.equal(b.report.cleanup.target,false);assert.equal(b.report.cleanup.disposed,0);assert.equal(b.report.cleanup.targetsReleased,1);
    assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(b.report.writes,[]);
    fs.writeFileSync('data/qa-studio/vehicle-camera-residency.json',JSON.stringify(b.report,null,2));
    console.log('Fork camera: real GPU pixels retained through memory reclamation in both modes/sides; disable releases exactly once.');
  });}finally{await fixture.close();}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
