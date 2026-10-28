'use strict';
// Compiled production app, real Chrome and disposable API/database only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer} = require('./qa-project-workspace-browser');
const {withBrowser} = require('./qa-public-publication-browser');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
async function run() {
  const at = process.argv.indexOf('--expected-bundle-sha256'), expected = at < 0 ? '' : process.argv[at + 1];
  assert(/^[a-f0-9]{64}$/.test(expected)); assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'bundle.js'))).digest('hex'), expected);
  fs.mkdirSync(OUTPUT, {recursive: true}); const fixture = await startTemporaryServer();
  try {
    const catalog = await fixture.request('/api/public/scenes'); assert.equal(catalog.status, 200); assert.equal(catalog.body.previewAllExamples, true); assert.equal(catalog.body.scenes.length, require('./validate-public-scenes').inventory().includedCount);
    await withBrowser(fixture.origin, async b => {
      await b.navigate('/');
      await b.call(() => {
        const c = context, view = c.roomTransitionView, renderer = c.renderer;
        window.__qaLoads = {coveredFrames: 0, warmFrames: 0, violations: [], finished: [], covers: 0};
        const originalRender = renderer.render.bind(renderer), coverRender = view.render.bind(view), cover = view.cover.bind(view), finish = view.finish.bind(view);
        view.cover = (...args) => {__qaLoads.covers++; return cover(...args);};
        view.render = (...args) => {window.__qaInCover = true; window.__qaLastScene = null; try {const result = coverRender(...args); if (__qaLastScene !== view.scene) __qaLoads.violations.push('Cover was not the final rendered scene'); return result;} finally {window.__qaInCover = false;}};
        renderer.render = (scene, camera) => {if (c.roomTransition && scene !== view.scene) {if (!__qaInCover) __qaLoads.violations.push('World rendered outside covered warm-up'); else __qaLoads.warmFrames++;} if (scene === view.scene) __qaLoads.coveredFrames++; window.__qaLastScene = scene; return originalRender(scene, camera);};
        view.finish = async request => {await finish(request); if (!view.active) __qaLoads.finished.push({scene:c.editor.currentProject?.publicSceneId,room:c.editor.roomId,allowed:c.editor.currentProject?.allowedRoomIds,visible:Object.entries(c.editorRoots).filter(([,root])=>{let node=root; while(node&&node!==c.scene){if(!node.visible)return false;node=node.parent;}return node===c.scene&&node.visible;}).map(([id])=>id)});};
      });
      const ready = () => b.until(() => b.evaluate('!context.editor.loadingProject&&!context.roomTransition&&!context.roomTransitionView.active'), 'Covered load did not settle.', 180000);
      const start = id => b.call(id => {window.__qaLoad = context.editor.accessView.loadPublic(id).then(() => {window.__qaLoadDone = true;}, error => {window.__qaLoadError=error.stack;}); window.__qaLoadDone=false; window.__qaLoadError=null; return true;}, id);
      const finish = async id => {await b.until(() => b.evaluate('__qaLoadDone||__qaLoadError'), 'Public project did not load: '+id, 180000); const error=await b.evaluate('__qaLoadError'); assert.equal(error,null); await ready(); const state=await b.evaluate('({id:context.editor.currentProject.publicSceneId,room:context.editor.roomId,allowed:context.editor.currentProject.allowedRoomIds,canEdit:context.editor.canEditDocument(),gl:context.renderer.getContext().getError(),assets:context.roomAssets.getStats()})'); assert.equal(state.id,id); assert.deepEqual(state.allowed,[state.room]); assert.equal(state.canEdit,false); assert.equal(state.gl,0); return state;};
      console.log('Loading Chrome: same-room complex CEDI replacement');
      await start('cedi-sorting-robotics'); await b.until(() => b.evaluate('context.roomTransitionView.active'), 'Complex project had no loading cover.'); await b.screenshot('room-loading-covered');
      b.report.complex = await finish('cedi-sorting-robotics'); await b.screenshot('room-loading-cedi');
      console.log('Loading Chrome: different native rooms and portal projections');
      await start('original-hall'); await finish('original-hall');
      assert.equal(await b.evaluate('context.editor.hooks.gotoRoom(1)'),true); await ready(); assert.equal(await b.evaluate('context.editor.currentProject.publicSceneId'),'original-sound');
      assert.equal(await b.evaluate('context.editor.hooks.gotoRoom(2)'),true); await ready(); assert.equal(await b.evaluate('context.editor.currentProject.publicSceneId'),'original-photogrammetry');
      await b.screenshot('room-loading-photogrammetry');
      b.report.rooms=[];
      for (const id of ['original-panorama1','original-panorama3','original-panorama1','inspection-sorting','l-transfer']) {console.log('Loading Chrome:',id); await start(id); b.report.rooms.push(await finish(id));}
      await b.screenshot('room-loading-restored');
      b.report.transition=await b.evaluate('JSON.parse(JSON.stringify(__qaLoads))'); assert(b.report.transition.covers>=9); assert(b.report.transition.coveredFrames>10); assert.deepEqual(b.report.transition.violations,[]);
      for (const state of b.report.transition.finished) {assert.equal(state.allowed.length,1); assert(state.visible.every(id=>id===state.room),JSON.stringify(state));}
      assert.deepEqual(b.report.exceptions,[]); assert.deepEqual(b.report.consoleErrors,[]); assert.deepEqual(b.report.apiFailures,[]); assert.deepEqual(b.report.writes,[]);
      b.report.bundleSha256=expected; b.report.temporaryDatabaseOnly=true;
      fs.writeFileSync(path.join(OUTPUT,'room-loading-browser.json'),JSON.stringify(b.report,null,2));
      console.log('Loading Chrome passed:',JSON.stringify({covers:b.report.transition.covers,coveredFrames:b.report.transition.coveredFrames,warmFrames:b.report.transition.warmFrames,violations:0}));
    }); assert.deepEqual(fixture.errors,[]); assert.deepEqual(fixture.writes,[]);
  } finally {await fixture.close();}
}
if(require.main===module) run().catch(error=>{console.error(error);process.exitCode=1;});
