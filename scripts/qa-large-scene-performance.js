'use strict';
// Compare the same versioned scenes at a fixed presentation policy. Chrome's
// software GPU is useful for relative work/resource counts, not Quest FPS.
const assert = require('node:assert/strict'), fs = require('node:fs'), crypto = require('node:crypto');
const {startStaticServer, withBrowser} = require('./qa-public-publication-browser');
async function run() {
  const args = process.argv.slice(2), value = (key, fallback) => {const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1];};
  const label = value('--label', 'current'), ids = value('--scenes', 'industrial-lab-complete,cedi-sorting-robotics,forklift-training').split(',');
  assert(/^[a-z0-9-]+$/.test(label)); const f = await startStaticServer();
  try {await withBrowser(f.origin, async b => {
    b.report.measurements = [];
    await b.send('Emulation.setDeviceMetricsOverride', {width: 960, height: 640, deviceScaleFactor: 1, mobile: false});
    for (const id of ids) {
      console.log('Measuring ' + label + ': ' + id);
      await b.navigate('/?scene=' + encodeURIComponent(id));
      await b.send('Page.bringToFront');
      await b.until(() => b.call(id => context.editor.currentProject?.publicSceneId === id && !context.roomTransition && !context.editor.loadingProject, id), 'Scene did not settle: ' + id, 180000);
      assert(await b.call(() => !document.hidden), 'Measure only a visible, rendering page.');
      await b.call(() => {const g = context.graphics; g.setMode('balanced'); g.tier = 1; g.tick = () => g.getStats(); g.applyDesktopRatio();});
      await b.send('Profiler.enable'); await b.send('Profiler.setSamplingInterval', {interval: 1000}); await b.send('Profiler.start');
      await b.evaluate('new Promise(resolve=>setTimeout(resolve,2200))'); const {profile} = await b.send('Profiler.stop');
      const byId = new Map(profile.nodes.map(node => [node.id, node])), samples = new Map();
      (profile.samples || []).forEach(id => {const n = byId.get(id), key = (n.callFrame.functionName || '(anonymous)') + ':' + n.callFrame.lineNumber; samples.set(key, (samples.get(key) || 0) + 1);});
      const state = await b.call(() => {
        const e = context.editor, r = context.renderer, objects = e.document.getObjects(e.roomId), meshes = [], allMaterials = new Set();
        e.root.traverse(n => {if (n.isMesh) {meshes.push(n); (Array.isArray(n.material) ? n.material : [n.material]).filter(Boolean).forEach(m => allMaterials.add(m));}});
        const dom = r.domElement;
        const textures = new Map();
        allMaterials.forEach(m => Object.keys(m).forEach(key => {
          const t = m[key]; if (!t || !t.isTexture) return;
          const image = t.image || {}, pixels = (image.width || 0) * (image.height || 0);
          if (!textures.has(t.uuid)) textures.set(t.uuid, {name: t.name, field: key, width: image.width, height: image.height, pixels, canvas: !!t.isCanvasTexture});
        }));
        return {scene: e.currentProject.publicSceneId, actors: objects.length, meshes: meshes.length, materials: allMaterials.size,
          canvas: [dom.width, dom.height], visible: !document.hidden, render: {...r.info.render}, gpu: {...r.info.memory}, programs: r.info.programs.length,
          resources: e.performance.getStats(), finishes: e.finishes?.getStats(), materialStats: e.materials?.stats,
          decals: e.wearPaint?.engine.stats, simulationTime: e.simulation.time, textureSizes: [...textures.values()].sort((a,b) => b.pixels-a.pixels).slice(0,40), heap: performance.memory && {used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit}, gl: r.getContext().getError()};
      });
      assert.equal(state.gl, 0); state.hot = [...samples].sort((a, b) => b[1] - a[1]).slice(0, 24); state.sampleCount = (profile.samples || []).length;
      b.report.measurements.push(state); console.log(JSON.stringify({scene:id,draws:state.render.calls,triangles:state.render.triangles,gpu:state.gpu,resources:state.resources,hot:state.hot.slice(0,8)}));
      fs.writeFileSync('data/qa-studio/performance-' + label + '.json', JSON.stringify({...b.report, bundleSha256:crypto.createHash('sha256').update(fs.readFileSync('bundle.js')).digest('hex')}, null, 2));
    }
    assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.writes, []);
  });} finally {await f.close();}
}
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {run};
