'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const schema=require('../../modules/logistica-industrial/contracts/behaviors.js');
const panel=require('../../modules/logistica-industrial/functions/almacenamiento/ui/RackLocationPanel.cjs');
const file=path.join(__dirname,'test-editor-runtime.js'),source=fs.readFileSync(file,'utf8');
const fixtures=new Function('require','__dirname',source.slice(0,source.indexOf('async function run()'))+'\nreturn {harness,storage,remote,dom};')(createRequire(file),__dirname);
const config=(d,o)=>d.getBehaviors(o).find(row=>row.type==='palletQueue'),copy=value=>JSON.parse(JSON.stringify(value));
const patch=(d,o,values)=>d.setBehaviors(o,d.getBehaviors(o).map(row=>row.type==='palletQueue'?Object.assign({},row,values):row));
async function run(){
  fixtures.storage.clear();fixtures.remote.projects.clear();const f=fixtures.harness(),e=f.editor;await e.ready;e.enter();const d=e.document;
  const a=d.addPrefab('hall','palletQueue','selective'),b=d.addPrefab('hall','palletQueue','mobile');
  assert.notEqual(schema.warehouseRacks.addressPrefix(config(d,a)),schema.warehouseRacks.addressPrefix(config(d,b)),'New rows need globally distinct visible addresses.');
  const cell=schema.warehouseRacks.layout(config(d,a)).cells.find(cell=>cell.bay===1&&cell.level===2);
  patch(d,a,{rackBayWidths:'2.4, 3.6',rackAssignments:JSON.stringify([{locationCode:cell.code,palletId:'PAL-000123'}])});
  const revised=config(d,a),twin=await d.pasteObject(d.captureObject(a),'hall',1);
  assert.notEqual(config(d,twin).rackRowCode,revised.rackRowCode);assert.equal(config(d,twin).rackBayWidths,revised.rackBayWidths);assert.equal(config(d,twin).rackAssignments,'[]');assert.equal(config(d,a).rackAssignments,revised.rackAssignments);
  assert.throws(()=>patch(d,b,{rackAisleCode:revised.rackAisleCode,rackRowCode:revised.rackRowCode}),/ya existen|duplicad/);
  const free=schema.warehouseRacks.layout(config(d,b)).cells[0];assert.throws(()=>patch(d,b,{rackAssignments:JSON.stringify([{locationCode:free.code,palletId:'PAL-000123'}])}),/ya tiene/);
  const renamed=panel.remapPlan(revised,Object.assign({},revised,{rackAisleCode:'A02',rackRowCode:'R10'}));patch(d,a,renamed);
  assert.equal(JSON.parse(config(d,a).rackAssignments)[0].palletId,'PAL-000123');assert.match(JSON.parse(config(d,a).rackAssignments)[0].locationCode,/^A02-R10-/);
  assert.throws(()=>panel.remapPlan(config(d,a),Object.assign({},config(d,a),{rackBays:1,rackBayWidths:''})),/Libera primero/);
  const before=await d.serialize(),floor=d.addPrefab('hall','palletQueue'),legacyControls=d.captureObject(floor).record.nodes;assert(Object.keys(legacyControls).some(path=>/^1\./.test(path)));
  const old=copy(before);for(const record of old.rooms.hall.additions){const c=record.behaviors.find(row=>row.type==='palletQueue');if(!schema.warehouseRacks.isRack(c))continue;delete c.rackAisleCode;delete c.rackRowCode;delete c.rackAssignments;c.withPanel=true;record.nodes=copy(legacyControls);}
  const reopened=fixtures.harness(),other=reopened.editor;await other.ready;await other.document.load(old);
  const prefixes=new Set();for(const record of old.rooms.hall.additions){const object=other.document.getObject(record.id),c=config(other.document,object);if(!schema.warehouseRacks.isRack(c))continue;const prefix=schema.warehouseRacks.addressPrefix(c);assert(!prefixes.has(prefix));prefixes.add(prefix);assert.equal(c.withPanel,false);let controls=0;object.traverse(node=>{controls+=other.document.getBehaviors(node).filter(row=>row.type==='control').length;});assert.equal(controls,0);assert(![...other.document.objects.keys()].some(id=>id.startsWith(record.id+'/1.')));}
  const invalid=copy(old);invalid.rooms.hall.additions[0].nodes={'0.999':copy(Object.values(legacyControls)[0])};await assert.rejects(()=>other.document.load(invalid),/descendiente desconocido/);
  e.leave();const simulation=e.simulation, id=a.userData.editorId, previous=simulation.records.get(id), host=fixtures.dom.createElement('section');
  const widget=panel.renderRuntime({document:fixtures.dom,parent:host,editor:e,objectId:id});assert(widget);
  simulation.start('hall');const live=simulation.records.get(id);assert.notEqual(live,previous);
  const location=simulation.palletQueueRuntime.locations(live)[0];simulation.command(id,'assignLocation',{locationCode:location.code,palletId:'PAL-NEW-SESSION'});widget.update();
  const all=node=>[node].concat(Array.from(node.children||[]).flatMap(all));assert(all(widget.root).some(node=>node.tagName==='OUTPUT'&&node.textContent.includes('PAL-NEW-SESSION')),'The visible inventory must use the live record after a full simulation restart/restore.');
  e.projectSync.stop();e.clearAssembly(true);other.projectSync.stop();other.clearAssembly(true);
  console.log('Rack authoring addresses: unique new/copy rows, independent reservations, identity-safe rename, destructive resize refusal, legacy HMI retirement/reload and strict unknown-node rejection passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
