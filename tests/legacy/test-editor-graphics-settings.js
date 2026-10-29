const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const file = __layout.map(path.join(__layout.oldDir("scripts/test-editor-graphics-settings.js"), 'test-editor-runtime.js')), source = fs.readFileSync(file, 'utf8');
const {harness, storage, remote} = new Function('require', '__dirname', source.slice(0, source.indexOf('async function run()')) + '\nreturn {harness,storage,remote};')(createRequire(file), __dirname);
async function run() {
  storage.clear(); remote.projects.clear(); const f = harness(), e = f.editor; await e.ready;
  const listeners = new Set(), calls = [], state = {mode: 'auto', effectiveProfile: 'economy', targetFPS: 60, renderScale: .75};
  f.ctx.graphics = {getState: () => state, getMode: () => state.mode, setMode: mode => { state.mode = mode; calls.push(mode); listeners.forEach(fn => fn(state)); }, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }};
  state.xrClarity='sharp';state.antialias=true;f.ctx.graphics.getXRClarity=()=>state.xrClarity;f.ctx.graphics.setXRClarity=value=>{state.xrClarity=value;listeners.forEach(fn=>fn(state));};
  const resizeOrder = [], originalSize = f.ctx.renderer.setSize; f.ctx.graphics.setViewport = () => resizeOrder.push('graphics'); f.ctx.renderer.setSize = (...args) => { resizeOrder.push('renderer'); return originalSize.apply(f.ctx.renderer, args); }; e.resize(); assert.deepEqual(resizeOrder.slice(0, 2), ['graphics', 'renderer'], 'Adaptive viewport limits are applied before resizing the editor buffer.');
  const before = await e.document.serialize(); e.performancePanel.hidden = false; e.resetPerformancePanel(); const panel = e.performanceGraphics; assert(panel);
  e.updatePerformancePanel(.5); e.updatePerformancePanel(.5); assert.equal(panel.root.parentNode, e.performancePanel); assert(e.performanceMetrics.textContent.includes('Dibujos:')); assert.equal(panel.select.value, 'auto');
  panel.select.value = 'ultra'; await panel.select.fire('change'); assert.deepEqual(calls, ['ultra']); assert(panel.effective.textContent.includes('Ahorro'), 'Requested cinematic quality keeps the effective hardware limit visible.');
  assert.equal(panel.claritySelect.value,'sharp');assert.equal(panel.values.edges.textContent,'Activo');panel.claritySelect.value='balanced';await panel.claritySelect.fire('change');assert.equal(state.xrClarity,'balanced');
  e.resetPerformancePanel(); assert.equal(e.performanceGraphics, panel); assert.equal(listeners.size, 1, 'Reopening performance reuses the same graphics controls.'); assert.deepEqual(await e.document.serialize(), before, 'Local graphics controls never mutate the project.');
  panel.dispose(); assert.equal(listeners.size, 0); e.projectSync.stop(); e.clearAssembly(true);
  console.log('Editor graphics: live performance metrics preserve interactive local profile controls, effective caps stay visible, reopened panels reuse subscriptions and project serialization stays literal.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
