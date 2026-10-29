'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const {createHash} = require('node:crypto');
const {startStaticServer, withBrowser} = require('./qa-public-publication-browser');
async function run() {
  const fixture = await startStaticServer();
  try { await withBrowser(fixture.origin, async b => {
    await b.send('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await b.send('Emulation.setUserAgentOverride', {userAgent:'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 OculusBrowser/38.0 Chrome/134.0.0.0 Safari/537.36'});
    for (const id of ['vr-robot-dispatch','vr-robot-transfer','vr-robot-turn']) {
      await b.navigate('/?scene='+id);
      await b.until(()=>b.call(id=>context.editor.currentProject?.publicSceneId===id&&!context.editor.loadingProject&&!context.roomTransition,id),'Compact scene failed to load: '+id);
      assert(await b.call(()=>context.graphics.hints.standaloneXR));
      await b.screenshot(id);
    }
    await b.evaluate('context.studio.open("scenes")');
    await b.until(()=>b.evaluate('Boolean(context.editor.accessView.sceneLibrary?.cards.length)'), 'Quest gallery failed to load.');
    const defaults = await b.call(()=>{const l=context.editor.accessView.sceneLibrary; return {category:l.category,ids:l.cards.filter(c=>!c.card.hidden).map(c=>c.entry.id),total:l.cards.length};});
    assert.equal(defaults.category,'Realidad virtual compacta'); assert.equal(defaults.ids.length,3); assert.equal(defaults.total,34);
    await b.screenshot('compact-vr-quest-library');
    await b.call(()=>{const l=context.editor.accessView.sceneLibrary;l.categorySelect.value='';l.categorySelect.dispatchEvent(new Event('change'));});
    assert.equal(await b.evaluate('context.editor.accessView.sceneLibrary.cards.filter(c=>!c.card.hidden).length'),34);
    assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(b.report.writes,[]);
    fs.writeFileSync('data/qa-studio/compact-vr-browser.json',JSON.stringify({...b.report,defaults,bundleSha256:createHash('sha256').update(fs.readFileSync("bundle.js")).digest('hex')},null,2));
    console.log('Quest browser profile: three compact scenes loaded, compact library default, all 34 accessible; no JS/console errors or account writes.');
  }); } finally {await fixture.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
