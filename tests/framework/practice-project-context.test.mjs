import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Execute the production method, replacing only its one explicit compiler
// import. No network client, account, project file or scene factory is used.
const filename=new URL('../../modules/logistica-industrial/integrations/StudioTools.js',import.meta.url);
const source=readFileSync(filename,'utf8');
const start=source.indexOf('  async createPracticeProject('),end=source.indexOf('\n  availableStudyRoom(',start);
assert.ok(start>=0&&end>start,'The actual production practice method must be present.');
const importExpression=/import\(\/\* webpackChunkName: "logistics-practice-scenes" \*\/ '\.\.\/practices\/runtime\/PracticeSceneBuilder\.js'\)/g;
const actualMethod=source.slice(start,end);
assert.equal([...actualMethod.matchAll(importExpression)].length,1,'Only the reviewed practice compiler import can be proxied.');
const load=(loader)=>new Function('loadPracticeCompiler','return class PracticeTools {\n'+actualMethod.replace(importExpression,'loadPracticeCompiler()')+'\n}')(loader);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

function fixture(hooks={}){
 const calls={compile:[],keep:0,create:[],apply:[],restore:0,sync:0,home:0,refresh:0,toasts:[]};
 const initial={secret:'original-private-content'},doc={value:initial,capture(){return this.value;},_restore(value){calls.restore++;this.value=value;}};
 const prepared={name:'Práctica L01',document:{format:'prepared-practice'},reports:[{id:'L01',expectedUnits:4}]};
 const saved={id:'practice-created',revision:1};
 const editor={document:doc,projectGeneration:7,active:true,editable:true,moduleEnabled:true,accessView:{identityGeneration:3},currentProject:{id:'prior-project'},
  canEditDocument(){return this.editable;},projectModules:{canShowLevel(id){assert.equal(id,'sector.logistics-industrial');return editor.moduleEnabled;}},
  async keepCurrentProject(){calls.keep++;if(hooks.keep)await hooks.keep(editor);},
  projectClient:{async createProject(name,value){calls.create.push({name,value});if(hooks.create)await hooks.create(editor);return saved;}},
  async applyServerProject(value,options){calls.apply.push({value,options});if(hooks.apply)await hooks.apply(editor);},
  entities:{sync(){calls.sync++;}},home(){calls.home++;},toast(message){calls.toasts.push(message);}};
 const Tools=load(async()=>({async compilePracticeProject(id,options){calls.compile.push({id,options});if(hooks.compile)await hooks.compile(editor);return prepared;}}));
 const tools=new Tools();tools.editor=editor;tools.assertStudyReady=()=>{};tools.refreshLabels=()=>{calls.refresh++;};
 return{editor,tools,calls,doc,initial,prepared,saved,run:()=>tools.createPracticeProject('L01',{cycleTime:2.5,units:4})};
}

test('the actual practice creation method rejects initial permission or module denial before loading or saving',async()=>{
 for(const change of [e=>{e.editable=false;},e=>{e.moduleEnabled=false;}]){
  const f=fixture();change(f.editor);await assert.rejects(f.run(),/permiso|módulo/);assert.equal(f.calls.compile.length,0);assert.equal(f.calls.keep,0);assert.equal(f.calls.create.length,0);assert.equal(f.calls.apply.length,0);assert.equal(f.doc.value,f.initial);
 }
});

test('identity, permission, module, document and project changes during compilation cannot save the current or a new project',async()=>{
 const changes=[e=>{e.accessView.identityGeneration++;},e=>{e.editable=false;},e=>{e.moduleEnabled=false;},e=>{e.document={value:'different-document'};},e=>{e.projectGeneration++;},e=>{e.active=false;}];
 for(const change of changes){
  const entered=deferred(),release=deferred(),f=fixture({compile:async()=>{entered.resolve();await release.promise;}}),pending=f.run();await entered.promise;change(f.editor);release.resolve();
  await assert.rejects(pending,/cambió|permiso|módulo/);assert.equal(f.calls.keep,0,'Do not save an unrelated current project.');assert.equal(f.calls.create.length,0);assert.equal(f.calls.apply.length,0);assert.equal(f.editor.creatingStudy,false);assert.equal(f.doc.value,f.initial);
 }
});

test('permission, module and identity are rechecked after keeping the current project and before the create API',async()=>{
 for(const change of [e=>{e.accessView.identityGeneration++;},e=>{e.editable=false;},e=>{e.moduleEnabled=false;}]){
  const entered=deferred(),release=deferred(),f=fixture({keep:async()=>{entered.resolve();await release.promise;}}),pending=f.run();await entered.promise;change(f.editor);release.resolve();
  await assert.rejects(pending,/permiso|módulo/);assert.equal(f.calls.keep,1);assert.equal(f.calls.create.length,0);assert.equal(f.calls.apply.length,0);assert.equal(f.editor.creatingStudy,false);
 }
});

test('a late successful server create never opens a practice in an inactive or changed account context',async()=>{
 for(const change of [e=>{e.active=false;},e=>{e.accessView.identityGeneration++;},e=>{e.moduleEnabled=false;}]){
  const entered=deferred(),release=deferred(),f=fixture({create:async()=>{entered.resolve();await release.promise;}}),pending=f.run();await entered.promise;change(f.editor);release.resolve();
  await assert.rejects(pending,/guardada en Otros proyectos/);assert.equal(f.calls.create.length,1);assert.equal(f.calls.apply.length,0);assert.equal(f.calls.restore,0);assert.equal(f.doc.value,f.initial);assert.equal(f.editor.currentProject.id,'prior-project');assert.equal(f.editor.creatingStudy,false);
 }
});

test('an account transition application failure preserves keepRoomCover and never restores private content outside the project opener',async()=>{
 const applicationError=Object.assign(new Error('La cuenta cambió durante la apertura.'),{keepRoomCover:true});
 const f=fixture({apply:async editor=>{editor.accessView.identityGeneration++;editor.document.value='covered-after-account-change';throw applicationError;}});
 await assert.rejects(f.run(),error=>error===applicationError&&error.keepRoomCover===true&&/guardada en Otros proyectos/.test(error.message));
 assert.equal(f.calls.restore,0,'StudioTools must not bypass the identity-aware project opener rollback.');assert.equal(f.doc.value,'covered-after-account-change');assert.equal(f.calls.sync,0);assert.equal(f.calls.home,0);assert.equal(f.calls.refresh,0);assert.equal(f.editor.lastPracticeReport,undefined);assert.equal(f.editor.creatingStudy,false);
});

test('successful production creation forwards explicit project and account guards, uses the compiled document and records the real result',async()=>{
 const f=fixture(),result=await f.run();assert.equal(f.calls.compile.length,1);assert.equal(f.calls.compile[0].id,'L01');assert.equal(f.calls.compile[0].options.nativeDocument,f.doc);assert.equal(f.calls.compile[0].options.cycleSeconds,2.5);
 assert.equal(f.calls.keep,1);assert.deepEqual(f.calls.create,[{name:f.prepared.name,value:f.prepared.document}]);assert.deepEqual(f.calls.apply,[{value:f.saved,options:{roomId:'hall',expectedProjectGeneration:7,accessGeneration:3}}]);
 assert.equal(result,f.editor.lastPracticeReport);assert.deepEqual(result,{projectId:f.saved.id,revision:1,reports:f.prepared.reports});assert.equal(f.calls.sync,1);assert.equal(f.calls.home,1);assert.equal(f.calls.refresh,1);assert.equal(f.calls.restore,0);assert.equal(f.editor.creatingStudy,false);
});
