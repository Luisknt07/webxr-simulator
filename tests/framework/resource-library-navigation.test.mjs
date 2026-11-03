import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../packages/tools/editor/src/ResourceBrowser.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class ResourceBrowser','class ResourceBrowser');
const Browser=new Function('catalog',source+'\nreturn ResourceBrowser;')({libraryTaxonomy:{}});
function fixture(width=340){
 const calls=[],node=name=>({scrollIntoView(options){calls.push({name,options});}}),category=node('category'),vertical=node('vertical-subgroup'),horizontal=node('horizontal-subgroup');
 const browser={active:true,listingVisible:true,tab:'library',navigationDisposed:false,navigationWidth:0,host:{clientWidth:width},state:{folder:'group:AL/palletized'},folderList:{scrollTop:800,querySelector:selector=>selector.includes('summary')?category:vertical},subfamilyList:{querySelector:()=>horizontal}};
 return{browser,calls,run:force=>Browser.prototype._syncNavigationLayout.call(browser,force)};
}
test('compact resize drops the stale vertical offset and reveals the selected real category plus subfamily without changing selection',()=>{
 const f=fixture();f.run();assert.equal(f.browser.folderList.scrollTop,0);assert.deepEqual(f.calls.map(row=>row.name),['category','horizontal-subgroup']);assert(f.calls.every(row=>row.options.block==='nearest'&&row.options.inline==='nearest'));assert.equal(f.browser.state.folder,'group:AL/palletized');f.run();assert.equal(f.calls.length,2,'An unchanged width does not repeatedly move navigation.');
 f.browser.host.clientWidth=560;f.run();assert.deepEqual(f.calls.slice(-2).map(row=>row.name),['category','vertical-subgroup']);
});
test('forced navigation refresh reveals a newly selected family while hidden, inactive and disposed instances stay inert',()=>{
 const f=fixture();f.run();f.run(true);assert.equal(f.calls.length,4);for(const flags of [{active:false},{listingVisible:false},{tab:'project'},{navigationDisposed:true}]){const row=fixture();Object.assign(row.browser,flags);row.run(true);assert.equal(row.calls.length,0);}
 const hidden=fixture(0);hidden.run(true);assert.equal(hidden.calls.length,0);const absent=fixture();absent.browser.folderList.querySelector=()=>null;absent.browser.subfamilyList.querySelector=()=>null;assert.doesNotThrow(()=>absent.run(true));
});
test('observer teardown releases only owned observation and makes already queued resize work inert',()=>{
 const f=fixture();let disconnected=0;Object.assign(f.browser,{navigationObserver:{disconnect(){disconnected++;}},_saveState(){},clearPreview(){},configurationDrafts:new Map(),familySelections:new Map(),invalidConfigurations:new Set(),setPreviewHost(){},thumbnails:null});
 Browser.prototype.dispose.call(f.browser);assert.equal(disconnected,1);assert.equal(f.browser.navigationObserver,null);f.run(true);assert.equal(f.calls.length,0);Browser.prototype.dispose.call(f.browser);assert.equal(disconnected,1);
});
