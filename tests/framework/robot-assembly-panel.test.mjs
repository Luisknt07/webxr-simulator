import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
const robots=require('../../modules/logistica-industrial/functions/robots/schema/robots.js');
const {Document}=require('../legacy/test-vehicle-storage.js');
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.value='';this.style={};this.disabled=false;}
 set textContent(text){this._text=text;this.children.forEach(c=>c.parentNode=null);this.children=[];}get textContent(){return this._text||'';}
 appendChild(child){child.parentNode=this;this.children.push(child);return child;}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}
 addEventListener(key,fn){if(!this.listeners.has(key))this.listeners.set(key,[]);this.listeners.get(key).push(fn);}
 async fire(key){for(const fn of this.listeners.get(key)||[])await fn({preventDefault(){}});}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}
}
const d={createElement:tag=>new Element(tag)},all=root=>[root,...root.children.flatMap(all)];
const source=fs.readFileSync(new URL('../../modules/logistica-industrial/functions/presentacion/runtime/RobotAssemblyPanel.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export const ROBOT_ASSEMBLY_STYLE','const ROBOT_ASSEMBLY_STYLE').replace('export default class RobotAssemblyPanel','class RobotAssemblyPanel');
const {Panel,style}=new Function('robots',source+'\nreturn {Panel:RobotAssemblyPanel,style:ROBOT_ASSEMBLY_STYLE};')(robots);
async function fixture(options={}){
 const model=new Document({}),world=new THREE.Group();model.registerRoom('hall',world);const robot=model.addPrefab('hall','robot','articulated-general');const objectId=robot.userData.editorId;
 if(options.legacy)model.setBehaviors(robot,model.getBehaviors(robot).map(c=>c.type==='robot'?{...c,visualModel:'legacy'}:c));
 let allowed=options.public!==true,closed=false,delayed=false,pending=null;const notices=[],previewed=[];
 const editor={document:model,roomId:'hall',projectGeneration:1,canEditDocument:()=>allowed,setEquipmentBehaviors:(object,next)=>model.setBehaviors(object,next),async perform(fn){if(delayed)pending=fn;else fn();}};
 const scope={id:objectId,object:robot,description:{config:model.getBehaviors(robot).find(c=>c.type==='robot')}};
 const viewer={document:d,documentModel:model,editor:options.public?null:editor,scope,current:()=>!closed&&editor.projectGeneration===1,editable:()=>!closed&&allowed,notify:message=>notices.push(message),close(){closed=true;if(this.assemblyPanel)this.assemblyPanel.dispose();}};
 if(options.preview){viewer.previewRobotAssembly=config=>previewed.push(config);viewer.clearRobotAssemblyPreview=()=>previewed.push('cleared');}
 const host=new Element('div'),panel=new Panel(viewer);viewer.assemblyPanel=panel;panel.mount(host);const before=await model.serialize();
 return{model,robot,objectId,scope,viewer,editor,panel,host,before,notices,previewed,allow(value){allowed=value;},delay(){delayed=true;},pending(){return pending;}};
}

test('assembly UI exposes compatible native parts, resets incompatible choices and never changes source before apply',async()=>{
 const f=await fixture(),p=f.panel;assert(Panel.supports(f.scope.description.config));assert.equal(p.profileButtons.size,5);assert.equal(p.fields.size,5);assert.equal(p.resolved.children.length,6);assert(!p.previewButton,'No fake preview affordance when the viewer provides no native preview.');
 for(const profile of ['auto',...robots.assemblies.profiles.map(row=>row.id)]){assert(p.selectProfile(profile));for(const [key,select]of p.fields){assert.deepEqual(select.children.map(c=>c.value),['auto',...robots.assemblies.partChoices(key,p.read()).filter(c=>c.compatible).map(c=>c.id)]);}}
 p.selectProfile('industrial-six-axis');p.fields.get('upperArmAssembly').value='ribbed-cast';await p.fields.get('upperArmAssembly').fire('change');p.fields.get('baseAssembly').value='anchored-drum';await p.fields.get('baseAssembly').fire('change');p.fields.get('wristAssembly').value='reinforced-inline';await p.fields.get('wristAssembly').fire('change');
 p.selectProfile('compact-training');assert.equal(p.draft.upperArmAssembly,'auto');assert.equal(p.draft.wristAssembly,'auto');assert.equal(p.draft.baseAssembly,'anchored-drum','A compatible explicit choice is preserved.');assert(p.status.textContent.includes('incompatibles'));assert.equal(p.resolution.id,'compact-training');assert.equal(p.resolved.children[0].getAttribute('data-robot-assembly-part'),'baseAssembly');
 p.draft.upperArmAssembly='heavy-box';assert.equal(p.refresh(),false);assert(p.applyButton.disabled);assert(p.status.textContent.includes('incompatible'));assert.equal(p.status.getAttribute('data-valid'),'false');assert.deepEqual(await f.model.serialize(),f.before);p.dispose();assert.equal(f.host.children.length,0);assert(style.includes('max-width:520px'));
});

test('apply changes the same native robot through normalizers and one-step undo, preserving unrelated functions',async()=>{
 const f=await fixture(),p=f.panel,object=f.robot,config=f.model.getBehaviors(object).find(c=>c.type==='robot');p.selectProfile('heavy-handling');p.toolSelect.value='vacuum';await p.toolSelect.fire('change');assert.equal(p.read().tool,'vacuum');const before=f.before;
 assert(await p.apply());assert.equal(f.model.getObject(f.objectId),object);const current=f.model.getBehaviors(object),next=current.find(c=>c.type==='robot');assert.equal(next.assemblyProfile,'heavy-handling');assert.equal(next.tool,'vacuum');assert.equal(next.speed,config.speed);assert.equal(next.sourceId,config.sourceId);assert(current.some(c=>c.type==='analytics'));assert.equal(robots.assemblies.resolve(next).parts.upperArmAssembly,'heavy-box');assert.equal(f.host.children.length,0);assert(f.notices.some(text=>text.includes('aplicado')));
 f.model.undo();assert.deepEqual(await f.model.serialize(),before,'The profile, compatible part configuration and tool undo as one authored operation.');
});

test('late permissions, document, room, project generation and object identity cannot authorize a stale apply',async()=>{
 for(const change of ['permission','document','room','generation','identity']){
  const f=await fixture();f.panel.selectProfile('compact-training');f.delay();assert.equal(await f.panel.apply(),false);assert(f.pending());
  if(change==='permission')f.allow(false);else if(change==='document')f.editor.document={};else if(change==='room')f.editor.roomId='sound';else if(change==='generation')f.editor.projectGeneration++;else f.model.getObject=()=>null;
  assert.throws(()=>f.pending()(),/proyecto|permisos/i,change);assert.deepEqual(await f.model.serialize(),f.before,change+' must not change the authored robot.');
 }
 const f=await fixture();f.panel.selectProfile('industrial-six-axis');f.allow(false);assert.equal(await f.panel.apply(),false);assert.deepEqual(await f.model.serialize(),f.before);assert(!f.notices.some(text=>text.includes('aplicado')));f.panel.dispose();
});

test('apply merges current behaviors and public/legacy consultation cannot silently adopt a new model',async()=>{
 const f=await fixture();f.panel.selectProfile('long-reach');f.delay();await f.panel.apply();const latest=f.model.getBehaviors(f.robot),prior=latest.find(c=>c.type==='robot');f.model.setBehaviors(f.robot,latest.map(c=>c.type==='robot'?{...c,speed:prior.speed+.1}:c));f.pending()();assert.equal(f.model.getBehaviors(f.robot).find(c=>c.type==='robot').speed,prior.speed+.1,'A deferred UI apply preserves a newer unrelated edit.');
 const pub=await fixture({public:true});assert(!pub.panel.applyButton);assert(pub.panel.fields.size===5);assert([...pub.panel.fields.values()].every(field=>field.disabled));assert([...pub.panel.profileButtons.values()].every(button=>button.disabled));assert.equal(pub.panel.selectProfile('heavy-handling'),false);assert.equal(await pub.panel.apply(),false);assert.deepEqual(await pub.model.serialize(),pub.before);assert(pub.panel.resolved.children.length===6);pub.panel.dispose();
 const legacy=await fixture({legacy:true});assert(!Panel.supports(legacy.scope.description.config));assert(!legacy.panel.applyButton);assert.equal(legacy.panel.profileButtons.size,0);assert.deepEqual(await legacy.model.serialize(),legacy.before);legacy.panel.dispose();
});

test('an optional private preview receives normalized configuration only on explicit request and clears on change',async()=>{
 const f=await fixture({preview:true}),p=f.panel;assert(p.previewButton);assert.equal(f.previewed.length,0);p.selectProfile('compact-training');assert.equal(f.previewed.length,0);assert(await p.preview());assert.equal(f.previewed[0].assemblyProfile,'compact-training');assert.equal(f.previewed[0].type,'robot');assert.deepEqual(await f.model.serialize(),f.before);p.selectProfile('industrial-six-axis');assert(f.previewed.includes('cleared'));p.dispose();assert.equal(f.host.children.length,0);
});
