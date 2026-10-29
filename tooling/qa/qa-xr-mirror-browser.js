const __layout = require("../layout.cjs");
'use strict';
// Real Chrome/WebGL shader + eye-copy check, using a synthetic split-eye FBO.
// This does not emulate a physical headset or claim Quest hardware performance.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {request, hash} = require('../maintenance/upgrade-cedi-examples'), {browserForRoom} = require('./qa-industrial-floor-browser');
const PROJECT = '05397448-a767-4f3b-8371-2aeb7ed18ae0', OUTPUT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-xr-mirror-browser.js"), '../data/qa-studio'));
async function inspectMirror() {
  const ctx = context, renderer = ctx.renderer, editor = ctx.editor, xr = renderer.xr;
  editor.projectSync.stop(); editor.saveProject = async () => { throw new Error('Mirror QA cannot save.'); }; editor.stopRuntime();
  const before = await editor.document.serialize(); renderer.setAnimationLoop(null);
  const environment = editor.entities.environment, gl = renderer.getContext(), V4 = ctx.xrMirror.viewport.constructor;
  const target = new environment.reflections.constructor(600, 400), mirror = new ctx.xrMirror.constructor(ctx, {document: {hidden: false}});
  const cameraBefore = {position: ctx.camera.position.toArray(), quaternion: ctx.camera.quaternion.toArray(), rig: ctx.cameraRig.matrixWorld.elements.slice()};
  const saved = {presenting: xr.isPresenting, getSession: xr.getSession, getCamera: xr.getCamera, enabled: xr.enabled,
    size: [renderer.domElement.width, renderer.domElement.height], dpr: renderer.getPixelRatio(), viewport: renderer.getViewport(new V4()), scissor: renderer.getScissor(new V4()), scissorTest: renderer.getScissorTest(),
    color: renderer.getClearColor().clone(), alpha: renderer.getClearAlpha(), info: {...renderer.info.render}, autoClear: renderer.autoClear};
  const sourceCamera = {cameras: [{viewport: new V4(0, 0, 300, 400)}, {viewport: new V4(300, 0, 300, 400)}]};
  const rows = [];
  try {
    renderer.setRenderTarget(target); renderer.setScissorTest(true);
    renderer.setScissor(0, 0, 300, 200); renderer.setClearColor(0xcc1919, 1); renderer.clear(true, true, false);
    renderer.setScissor(0, 200, 300, 200); renderer.setClearColor(0x19cc19, 1); renderer.clear(true, true, false);
    renderer.setScissor(300, 0, 300, 400); renderer.setClearColor(0x1919cc, 1); renderer.clear(true, true, false);
    // A real WebGL framebuffer simulates the opaque layer backing. Production
    // never inspects opaque attachments or accesses renderer private properties.
    const framebuffer = renderer.properties.get(target).__webglFramebuffer;
    const session = {renderState: {baseLayer: {framebuffer, framebufferWidth: 600, framebufferHeight: 400}}};
    xr.getSession = () => session; xr.getCamera = () => sourceCamera;
    for (const [width, height] of [[320, 180], [180, 320]]) {
      xr.isPresenting = false; renderer.setFramebuffer(null); renderer.setRenderTarget(null); renderer.setSize(width / saved.dpr, height / saved.dpr, false); xr.isPresenting = true;
      renderer.setFramebuffer(framebuffer); renderer.setRenderTarget(null); renderer.setViewport(3, 7, 111, 81); renderer.setScissor(2, 5, 77, 66); renderer.setScissorTest(true);
      const state = {viewport: renderer.getViewport(new V4()).toArray(), scissor: renderer.getScissor(new V4()).toArray(), scissorTest: renderer.getScissorTest(), info: {...renderer.info.render}, enabled: xr.enabled, shadows: renderer.shadowMap.enabled};
      mirror.elapsed = Infinity;
      const copied = mirror.postRender(editor.hooks.renderScene, ctx.camera, 1 / 72), stats = mirror.getStats();
      if (!copied) throw new Error('The real GPU mirror did not draw: ' + JSON.stringify(stats));
      const restored = {viewport: renderer.getViewport(new V4()).toArray(), scissor: renderer.getScissor(new V4()).toArray(), scissorTest: renderer.getScissorTest(), info: {...renderer.info.render}, enabled: xr.enabled, shadows: renderer.shadowMap.enabled};
      renderer.setFramebuffer(null); renderer.setRenderTarget(null);
      const pixels = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const sample = (x, y) => Array.from(pixels.slice((Math.floor(y * height) * width + Math.floor(x * width)) * 4, (Math.floor(y * height) * width + Math.floor(x * width)) * 4 + 4));
      const samples = [[.05, .1], [.95, .1], [.05, .9], [.95, .9], [.5, .1], [.5, .9]].map(([x, y]) => ({x, y, rgba: sample(x, y)}));
      const scale = mirror.material.uniforms.mirrorScale.value.toArray();
      rows.push({width, height, stats, scale, displayedAspect: stats.width * scale[0] / (stats.height * scale[1]), samples, state, restored, gl: gl.getError(), shader: renderer.info.programs.map(program => ({name: program.name, runnable: program.diagnostics ? program.diagnostics.runnable : null}))});
    }
    const stableTexture = mirror.texture, builds = mirror.getStats().allocations;
    renderer.setFramebuffer(framebuffer); renderer.setRenderTarget(null); for (let index = 0; index < 10; index++) mirror.postRender(editor.hooks.renderScene, ctx.camera, 1 / 72);
    const stable = {sameTexture: mirror.texture === stableTexture, allocations: mirror.getStats().allocations, before: builds, frames: mirror.getStats().frames};
    mirror.reset();
    return {rows, stable, released: mirror.getStats().estimatedGpuBytes === 0, cameraBefore,
      cameraAfter: {position: ctx.camera.position.toArray(), quaternion: ctx.camera.quaternion.toArray(), rig: ctx.cameraRig.matrixWorld.elements.slice()},
      unchanged: JSON.stringify(before) === JSON.stringify(await editor.document.serialize()), gl: gl.getError()};
  } finally {
    mirror.dispose(); xr.getSession = saved.getSession; xr.getCamera = saved.getCamera; xr.isPresenting = saved.presenting; xr.enabled = saved.enabled;
    renderer.setFramebuffer(null); renderer.setRenderTarget(null); target.dispose(); renderer.setSize(saved.size[0] / saved.dpr, saved.size[1] / saved.dpr, false);
    renderer.setClearColor(saved.color, saved.alpha); renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest); renderer.autoClear = saved.autoClear;
  }
}
async function run() {
  fs.mkdirSync(OUTPUT, {recursive: true}); const before = (await request('/api/projects/' + PROJECT)).project;
  const report = await browserForRoom('sound')(PROJECT, async b => {
    await b.until(() => b.evaluate('Boolean(context.xrMirror&&context.editor.entities.environment.reflections)'), 'The XR mirror index integration did not initialize.');
    const result = await b.evaluate('(' + inspectMirror.toString() + ')()');
    for (const row of result.rows) {
      assert.equal(row.stats.mono, true); assert(row.stats.width * row.stats.height <= 4000000); assert.deepEqual(row.restored, row.state); assert.equal(row.gl, 0);
      assert(Math.abs(row.displayedAspect - row.width / row.height) < 1e-12);
      row.samples.forEach(sample => { const [red, green, blue] = sample.rgba; assert(blue < 35, 'The right blue eye must never appear on the canvas.'); assert(sample.y < .5 ? red > 180 && green < 35 : green > 180 && red < 35, 'The one-eye view keeps the expected orientation and complete normal canvas coverage.'); });
      assert(row.shader.every(program => program.runnable !== false));
    }
    assert(result.stable.sameTexture && result.stable.allocations === result.stable.before); assert(result.released && result.unchanged); assert.deepEqual(result.cameraAfter, result.cameraBefore); assert.equal(result.gl, 0);
    assert.deepEqual(b.writes, []); assert.deepEqual(b.exceptions, []); assert.deepEqual(b.consoleErrors, []);
    return {readOnly: true, backing: 'Synthetic WebGL split-eye framebuffer, not a physical XR session', result, writes: b.writes, exceptions: b.exceptions, consoleErrors: b.consoleErrors};
  });
  const after = (await request('/api/projects/' + PROJECT)).project; assert.equal(after.revision, before.revision); assert.equal(hash(after.document), hash(before.document));
  fs.writeFileSync(__layout.map(path.join(OUTPUT, 'xr-mirror-browser.json')), JSON.stringify({projectId: PROJECT, revision: after.revision, report}, null, 2)); console.log('XR mono mirror real Chrome GPU copy passed: normal landscape/portrait canvas, one eye, exact state/poses, GL0, no writes.');
}
const keepAlive = setInterval(() => {}, 1000);
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
