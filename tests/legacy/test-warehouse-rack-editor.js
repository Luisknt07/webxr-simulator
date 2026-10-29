const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const schema=require('../../modules/logistica-industrial/contracts/behaviors'),catalog=require('../../modules/logistica-industrial/contracts/resourceCatalog');
const prefix=(file,names)=>{const p=__layout.map(path.join(__layout.oldDir("scripts/test-warehouse-rack-editor.js"),file)),source=fs.readFileSync(p,'utf8');return new Function('require','__dirname',source.slice(0,source.indexOf('async function run()'))+'\nreturn {'+names+'};')(createRequire(p),__dirname);};
const editorFixture=prefix('test-editor-runtime.js','harness,storage,remote'),resources=prefix('test-resource-browser.js','makeBrowser');
const all=node=>[node].concat(Array.from(node.children||[]).flatMap(all));
async function tick(){for(let i=0;i<16;i++)await Promise.resolve();}
async function run(){
 const entries=catalog.rackResources();assert.equal(entries.length,14);assert.equal(new Set(entries.map(r=>r.id)).size,14);assert(catalog.CATEGORIES.some(c=>c.id==='racks'&&c.children.length===3));
 assert(entries.every(r=>r.status==='functional'&&r.action.kind==='palletQueue'));assert.equal(entries.find(r=>r.variant==='selective').id,'library:storage.rack');assert.equal(entries.find(r=>r.variant==='vertical-lift').id,'library:storage.automatic');
 const b=resources.makeBrowser().browser;b.state.folder='racks';b.state.query='';b.state.kind='equipment';b.render();assert.equal(b.cards.size,14,'The new top-level category remains visible under the equipment filter.');
 for(const group of ['palletized','picking','automated']){b.state.folder='racks/'+group;b.render();assert(b.cards.size>0);assert(b.resources.filter(r=>b.cards.has(r.id)).every(r=>r.subcategory===group));}b.dispose();
 editorFixture.storage.clear();editorFixture.remote.projects.clear();const f=editorFixture.harness(),e=f.editor;await e.ready;e.enter();
 const field=key=>all(e.inspectorContent).find(node=>node.getAttribute('data-behavior-field')===key),change=async(key,value)=>{const input=field(key);assert(input,'Missing inspector field '+key);input.value=value;await input.fire('change');await tick();};
 const rack=e.document.addPrefab('hall','palletQueue','selective');e.select(rack);assert(field('rackBays')&&field('rackMaxLoadKg'));assert.equal(field('rackSelectedSlot').tagName,'SELECT');assert(field('capacity').disabled);
 const count=e.document.getBehaviors(rack).find(c=>c.type==='palletQueue').capacity;await change('rackBays',3);assert(e.document.getBehaviors(rack).find(c=>c.type==='palletQueue').capacity>count);assert.equal(rack.userData.editorDescriptor.variant,'selective');
 await change('rackSystem','mobile');assert.equal(rack.userData.editorDescriptor.variant,'mobile');assert(field('rackOpenAisle'));const hmi=all(rack).flatMap(o=>e.document.getBehaviors(o).filter(c=>c.type==='control'));assert(hmi.some(c=>c.command==='openAisle'&&c.targetId===rack.userData.editorId&&c.value===-1),'The existing physical HMI targets this rack and uses its selected aisle.');
 await change('rackSystem','light-duty');assert(!field('palletType'));assert(!field('rackOpenAisle'));assert(field('rackMaxLoadKg'));
 await change('rackSystem','floor');assert.equal(rack.userData.editorDescriptor.variant,undefined);assert(!field('rackBays'));assert(field('rackSystem'));assert.equal(Object.hasOwn(e.document.getBehaviors(rack).find(c=>c.type==='palletQueue'),'rackSystem'),false,'Viewing floor controls does not rewrite old stock configurations.');
 await change('rackSystem','push-back');assert.equal(rack.userData.editorDescriptor.variant,'push-back');assert(field('rackSlope'));assert(all(rack).some(o=>e.document.getBehaviors(o).some(c=>c.type==='control'&&c.command==='prepareRackInput'&&c.targetId===rack.userData.editorId)));
 const variableKeys=e.simulationVariables(rack).map(v=>v.key);assert(variableKeys.includes('rackSelectedSlot')&&variableKeys.includes('rackStatus'));
 e.projectSync.stop();e.clearAssembly(true);console.log('Warehouse editor: dedicated14-model category, equipment/subfamily search, real inspector resize/presets, addressed slot selector, physical HMI remapping, compatibility-specific fields, floor legacy preservation and runtime signal discovery passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
