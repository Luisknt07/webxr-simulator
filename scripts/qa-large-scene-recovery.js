'use strict';
// Real compiled, anonymous Pages world. No accounts, persistence or live DB.
const assert = require('node:assert/strict'), fs = require('node:fs');
const {startStaticServer, withBrowser} = require('./qa-public-publication-browser');
async function run() {
  const fixture = await startStaticServer();
  try { await withBrowser(fixture.origin, async b => {
    await b.navigate('/?scene=forklift-training'); await b.send('Page.bringToFront');
    await b.until(() => b.call(() => !context.roomTransition && !context.roomTransitionView.active && !context.editor.loadingProject), 'World did not settle.', 180000);
    await b.call(() => {
      window.__recoveryInspect = () => {
        const c = context, r = c.renderer, gl = r.getContext(), e = c.editor, scene = e.hooks.renderScene, env = e.entities.environment, lights = [], materials = [], seen = new Set();
        // context.scene is only the current room subtree. The production frame
        // renders the outer Scene, which owns global lights and environment.
        r.setRenderTarget(null); r.render(scene,c.camera);
        const shown = object => {for (let node = object; node; node = node.parent) if (!node.visible) return false; return true;};
        const array = value => value && value.toArray ? value.toArray() : ArrayBuffer.isView(value) ? Array.from(value) : value;
        scene.traverse(object => {
          if (object.isLight) lights.push({name:object.name,type:object.type,visible:object.visible,shown:shown(object),layers:object.layers.mask,intensity:object.intensity,color:object.color.toArray(),position:object.position.toArray(),world:object.matrixWorld.elements.slice(12,15),parent:object.parent && object.parent.name,castShadow:object.castShadow});
          const material = object.material;
          if (!shown(object) || !material || !material.isMeshStandardMaterial || seen.has(material) || materials.length >= 12) return; seen.add(material);
          const variants = r.properties.get(material).__webxrInstancingVariants || {}, states = {};
          if (!Object.keys(variants).length) return;
          for (const [key,state] of Object.entries(variants)) {
            const uniforms = state.shader && state.shader.uniforms || {}, program = state.program && state.program.program;
            const gpu = name => {const location = program && gl.getUniformLocation(program,name);return location ? array(gl.getUniform(program,location)) : null;};
            states[key] = {program:state.program && state.program.id,ambient:uniforms.ambientLightColor && array(uniforms.ambientLightColor.value),directional:uniforms.directionalLights && uniforms.directionalLights.value.map(light=>({color:array(light.color),direction:array(light.direction)})),points:uniforms.pointLights && uniforms.pointLights.value.map(light=>({color:array(light.color),position:array(light.position),distance:light.distance,decay:light.decay})),gpuAmbient:gpu('ambientLightColor'),gpuDirColor:gpu('directionalLights[0].color'),gpuPointColor:gpu('pointLights[0].color'),gpuExposure:gpu('toneMappingExposure'),gpuDiffuse:gpu('diffuse')};
          }
          materials.push({object:object.name,layers:object.layers.mask,type:material.type,name:material.name,color:material.color.toArray(),metalness:material.metalness,roughness:material.roughness,envIntensity:material.envMapIntensity,map:material.map && {id:material.map.id,version:material.map.version,size:material.map.image && [material.map.image.width,material.map.image.height]},normal:object.geometry && object.geometry.attributes.normal && Array.from(object.geometry.attributes.normal.array.slice(0,9)),states});
        });
        const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixel=new Uint8Array(4);let bright=0,minimum=255,maximum=0;
        for(let y=1;y<8;y++)for(let x=1;x<12;x++){gl.readPixels(Math.floor(w*x/12),Math.floor(h*y/8),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);const value=(pixel[0]+pixel[1]+pixel[2])/3;if(value>12)bright++;minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);}
        return {bright,minimum,maximum,lights,materials,environment:{stats:{...env.stats},sceneIsContext:env.scene===c.scene,hookIsContext:scene===c.scene,renderSceneIsEnvironment:scene===env.scene,signature:env.signature,reflection:env.reflections && {texture:env.reflections.texture.id,width:env.reflections.width,height:env.reflections.height},originalEnvironment:env.original && env.original.environment && env.original.environment.id,sceneEnvironment:scene.environment && scene.environment.id},renderer:{toneMapping:r.toneMapping,exposure:r.toneMappingExposure,encoding:r.outputEncoding,shadow:r.shadowMap.enabled,viewport:Array.from(gl.getParameter(gl.VIEWPORT)),scissor:gl.isEnabled(gl.SCISSOR_TEST),framebuffer:!!gl.getParameter(gl.FRAMEBUFFER_BINDING),colorMask:Array.from(gl.getParameter(gl.COLOR_WRITEMASK)),depthMask:gl.getParameter(gl.DEPTH_WRITEMASK)},camera:{position:c.camera.position.toArray(),world:c.camera.matrixWorld.elements,projection:c.camera.projectionMatrix.elements},gl:gl.getError()};
      };
      return true;
    });
    b.report.baseline = await b.call(() => __recoveryInspect()); await b.screenshot('large-scene-baseline');
    assert(await b.call(() => {
      const canvas = context.renderer.domElement, gl = context.renderer.getContext();
      window.__restoreCount = 0; canvas.addEventListener('webglcontextrestored', () => window.__restoreCount++);
      window.__lossExtension = gl.getExtension('WEBGL_lose_context');
      if (!__lossExtension) return false; __lossExtension.loseContext(); return true;
    }), 'Chrome must expose context loss for this regression.');
    await b.until(() => b.call(() => context.graphics.getStats().contextLost), 'Loss was not observed.');
    await b.call(() => { setTimeout(() => __lossExtension.restoreContext(), 200); return true; });
    await b.until(() => b.call(() => __restoreCount > 0 && !context.graphics.getStats().contextLost), 'Context did not recover.', 180000);
    b.report.naturalRecovery = await b.call(async () => {
      const beforeFrame = context.renderer.info.render.frame;
      for (let index = 0; index < 5; index++) await new Promise(resolve => requestAnimationFrame(resolve));
      return {beforeFrame,afterFrame:context.renderer.info.render.frame};
    });
    assert(b.report.naturalRecovery.afterFrame > b.report.naturalRecovery.beforeFrame, 'The production animation loop did not resume after restoration.');
    await b.screenshot('large-scene-natural-recovery');
    const state = await b.call(() => {
      const c = context, r = c.renderer, gl = r.getContext();
      // Match the production frame: restore the environment/reflection owner
      // after Three's restore listener has created fresh internal caches.
      c.editor.entities.sync(); c.editor.entities.tick(.02); c.editor.execute(.02, 1);
      r.setRenderTarget(null); r.render(c.editor.hooks.renderScene, c.camera);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, pixel = new Uint8Array(4); let bright = 0, minimum = 255, maximum = 0;
      for (let y = 1; y < 8; y++) for (let x = 1; x < 12; x++) {
        gl.readPixels(Math.floor(w*x/12), Math.floor(h*y/8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const value = (pixel[0]+pixel[1]+pixel[2])/3; if (value > 12) bright++; minimum=Math.min(minimum,value); maximum=Math.max(maximum,value);
      }
      return {scene:c.editor.currentProject.publicSceneId, restored:__restoreCount, bright, minimum, maximum, gl:gl.getError(), render:{...r.info.render}, performance:c.editor.performance.getStats()};
    });
    b.report.recovery = state; b.report.details = await b.call(() => __recoveryInspect()); fs.writeFileSync('data/qa-studio/large-scene-recovery.json', JSON.stringify(b.report,null,2));
    if (process.argv.includes('--diagnose')) {await b.screenshot('large-scene-recovery-diagnostic'); return;}
    assert.equal(state.gl, 0); assert.equal(state.restored, 1); assert(state.render.triangles > 10000); assert(state.bright > 20 && state.maximum-state.minimum > 10, 'Recovered world must contain visible, nonuniform pixels.');
    assert(b.report.baseline.bright > 20 && b.report.details.environment.renderSceneIsEnvironment, 'Recovery must inspect the same lit root Scene as the production frame.');
    assert(state.bright >= b.report.baseline.bright * .8, 'Context restoration unexpectedly darkened the production world.');
    assert.deepEqual(b.report.details.camera,b.report.baseline.camera,'Recovery must preserve the actual viewer camera pose and projection.');
    await b.screenshot('large-scene-context-recovery');
    b.report.recovery = state; assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.writes, []);
    fs.writeFileSync('data/qa-studio/large-scene-recovery.json', JSON.stringify(b.report,null,2));
    console.log('Large scene context recovery: rendered geometry, nonblack pixels, instancing/materials and zero GL/errors/writes passed.');
  }); } finally {await fixture.close();}
}
if (require.main === module) run().catch(error => {console.error(error);process.exitCode=1;});
module.exports = {run};
