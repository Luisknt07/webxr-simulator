'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const source=fs.readFileSync(path.join(__dirname,'test-editor-runtime.js'),'utf8'),file=path.join(__dirname,'test-editor-runtime.js');
const {harness,THREE}=new Function('require','__dirname',source.slice(0,source.indexOf('async function run()'))+'\nreturn {harness,THREE};')(createRequire(file),__dirname);
const floorSchema=require('../shared/industrialFloor'),{validateDocument}=require('../server/validation');
const FloorEditor=new Function('THREE','floorSchema',fs.readFileSync(path.join(__dirname,'../src/editor/FloorPlanEditor.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class FloorPlanEditor','return class FloorPlanEditor'))(THREE,floorSchema);
async function run(){
  const f=harness(),e=f.editor;await e.ready;e.active=true;const api=new FloorEditor(e),base=floorSchema.normalize({type:'industrialFloor',version:1,bounds:[-10,-10,10,10],floorY:0});
  assert(!Object.hasOwn(base,'texts'),'Legacy descriptors keep their canonical representation.');
  const plan=api.descriptor(base,[{type:'walkways',x:0,z:0,width:1.6,depth:8},{type:'labels',text:'LÍNEA DE ENVASADO',x:0,z:1,width:3,depth:.6,angle:90},{type:'signs',text:'DESPACHO 02',x:4,z:2,kind:1,angle:45}]);
  const created=api.apply(plan,api.scope()),id=created.userData.editorId;assert.equal(plan.texts.length,2);assert.deepEqual(api.rows(plan).filter(r=>r.text).map(r=>r.text),plan.texts);
  const before=JSON.stringify(plan),scope=api.scope(created),rows=api.rows(plan);rows[1].text='ENSAMBLE FINAL';rows[0].width=2.2;const changed=api.descriptor(base,rows);
  assert.equal(api.apply(changed,scope),created);assert.equal(created.userData.editorId,id);assert.equal(created.userData.editorDescriptor.texts[0],'ENSAMBLE FINAL');
  const changedGeometry=created.children[0];e.document.undo();assert.equal(JSON.stringify(created.userData.editorDescriptor),before);assert.notEqual(created.children[0],changedGeometry,'Undo rebuilds the real floor visual, not just metadata.');
  e.document.redo();assert.equal(created.userData.editorDescriptor.texts[0],'ENSAMBLE FINAL');
  const saved=await e.document.serialize();validateDocument(saved,()=>{throw Error('No imports');});
  const loaded=harness();await loaded.editor.ready;await loaded.editor.document.load(saved);const restored=loaded.editor.document.getObject(id);assert.deepEqual(restored.userData.editorDescriptor,changed);assert(restored.children[0].userData.industrialFloorObstacleBounds.length===1);
  e.document.setTransform(created,{position:[2,0,3]});api.apply(changed,scope);assert.deepEqual(created.position.toArray(),[2,0,3]);
  const good=e.canEditDocument;e.canEditDocument=()=>false;assert.throws(()=>api.apply(changed,scope),/editable/);e.canEditDocument=good;
  e.projectGeneration++;assert.throws(()=>api.apply(changed,scope),/cambió/);e.projectGeneration--;
  assert.throws(()=>floorSchema.normalize({...base,texts:['']}));assert.throws(()=>floorSchema.normalize({...base,texts:Array(25).fill('x')}));assert.throws(()=>floorSchema.normalize({...base,texts:['a'.repeat(65)]}));assert.throws(()=>floorSchema.normalize({...base,texts:false}));
  const drawn=[],visual=floorSchema.createVisual(THREE,changed,()=>({getContext:()=>({clearRect(){},fillText(t){drawn.push(t);}})}));
  assert(drawn.includes('ENSAMBLE FINAL')&&drawn.includes('DESPACHO 02'));const lettering=visual.children.find(m=>m.material.map);assert.equal(lettering.material.map.image.height,512);assert.equal(lettering.material.map.anisotropy,4);assert(visual.children.length<=8,'Custom texts share the same bounded batches and atlas.');
  e.projectSync.stop();loaded.editor.projectSync.stop();console.log('Floor plans: arbitrary Spanish labels/signs, editable sizes/positions, bounded atlas, real visual undo/redo, same object identity, save/load/server validation, read-only and stale-project guards passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
