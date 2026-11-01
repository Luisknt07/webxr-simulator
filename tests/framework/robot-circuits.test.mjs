import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const circuits=require('../../modules/logistica-industrial/functions/presentacion/schema/robot-circuits.js');
const learning=require('../../modules/logistica-industrial/functions/presentacion/schema/equipment-learning.js');
const catalog=require('../../modules/logistica-industrial/functions/presentacion/schema/equipment-study.js');
const THREE=require('three');
const {Document}=require('../legacy/test-vehicle-storage.js');

test('electrical sheets connect every named wire to real selectable terminals, with separate power, safety and feedback routes',()=>{
 const rendered=new Set();
 assert.equal(Object.keys(circuits.VIEWS).length,3);
 for(const view of Object.values(circuits.VIEWS)){
  const ids=new Set();
  for(const device of view.devices){assert(circuits.COMPONENTS[device.id]);assert(device.w>0&&device.h>0);}
  for(const [id,port]of Object.entries(view.ports)){assert(circuits.TERMINALS[id],id);assert(port.x>=0&&port.x<=view.width&&port.y>=0&&port.y<=view.height);}
  for(const route of view.routes){
   assert(!ids.has(route.id));ids.add(route.id);rendered.add(route.id);
   const wire=circuits.WIRES[route.id];assert(wire);assert(circuits.KINDS[wire.kind]);
   const a=view.ports[wire.from],b=view.ports[wire.to];assert(a&&b,route.id);
   assert.deepEqual(route.points[0],[a.x,a.y],route.id+' source');assert.deepEqual(route.points.at(-1),[b.x,b.y],route.id+' destination');
   route.points.forEach(([x,y],index)=>{assert(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=view.width&&y>=0&&y<=view.height);if(index){const [px,py]=route.points[index-1];assert(x===px||y===py,'Orthogonal cable route '+route.id);assert(x!==px||y!==py,'No zero-length cable segment '+route.id);for(const [id,port]of Object.entries(view.ports)){if(id===wire.from||id===wire.to)continue;const touches=x===px&&port.x===x&&port.y>=Math.min(y,py)&&port.y<=Math.max(y,py)||y===py&&port.y===y&&port.x>=Math.min(x,px)&&port.x<=Math.max(x,px);assert(!touches,route.id+' must not appear connected to unrelated terminal '+id);}}});
   for(const id of [wire.from,wire.to]){const terminal=circuits.TERMINALS[id];assert.equal(terminal.kind,wire.kind);assert(circuits.COMPONENTS[terminal.component]);assert(terminal.meaning&&terminal.unit);}
   assert(circuits.sources(wire.sourceIds).length>0);
  }
 }
 assert.deepEqual(rendered,new Set(Object.keys(circuits.WIRES)));
 assert.equal(rendered.size,40);assert.equal(Object.keys(circuits.TERMINALS).length,77);
 assert.equal(circuits.WIRES.W_U.to,'M1.U');assert.equal(circuits.WIRES.W_ENC_AP.to,'D1.EA+');assert.notEqual(circuits.WIRES.W_U.kind,circuits.WIRES.W_ENC_AP.kind);
 for(const wire of Object.values(circuits.WIRES).filter(w=>w.kind==='pe'))for(const id of [wire.from,wire.to])assert.equal(circuits.TERMINALS[id].kind,'pe','PE is never connected to the control return.');
 assert.notEqual(circuits.WIRES.W_GRIP.to,circuits.WIRES.W_CONFIRM.to,'Command is different from independent confirmation.');
 assert.deepEqual([circuits.WIRES.W_COIL.from,circuits.WIRES.W_COIL.to],['Q1.OUT','Y1.A1']);assert.deepEqual([circuits.WIRES.W_COIL_0.from,circuits.WIRES.W_COIL_0.to],['Y1.A2','TB0.Y1']);
 assert.notEqual(circuits.WIRES.W_STO_A.to,circuits.WIRES.W_STO_B.to);
 assert.deepEqual(circuits.nativeCorrespondence('W_U').componentIds,['robot.harness','robot.base-services']);assert(circuits.nativeCorrespondence('W_COIL').componentIds.includes('robot.tool-services'));assert(circuits.nativeCorrespondence('W_SHAFT').useJoint);assert.equal(circuits.nativeCorrespondence('unknown'),null);
});

test('the educational sequence retains manufacturer-specific distinctions and only trusted references',()=>{
 assert.equal(circuits.STEPS.length,7);
 for(const step of circuits.STEPS){assert(circuits.VIEWS[step.view]);for(const id of step.wires)assert(circuits.VIEWS[step.view].routes.some(route=>route.id===id));}
 for(const source of Object.values(circuits.SOURCES))assert.equal(learning.safeOfficialURL(source.url),source.url);
 assert(circuits.COMPONENTS.E1.summary.includes('CANopen'));assert(circuits.COMPONENTS.E1.diagnosis.includes('RM9000'));
 assert(circuits.WIRES.W_STO_B.explanation.includes('F-TM'),'Two-channel example must not pretend to use the Siemens STO+/STO- pinout.');
 assert(circuits.WIRES.W_STO_A.sourceIds.includes('driveSafety'));
 assert(circuits.WIRES.W_ENC_SUPPLY.explanation.includes('24 V'));
 for(const c of Object.values(circuits.COMPONENTS)){assert(c.steps.length>=3);assert(c.diagnosis);assert(c.componentIds.length);assert(circuits.sources(c.sourceIds).length);assert(!('geometry' in c));}
});

test('readings use actual joint coordinates or captured pose, never fake electrical measurements',()=>{
 const description={type:'robot',config:{tool:'gripper'},joints:[{jointId:'J1',current:.25,unit:'rad'}]},record={variables:{powered:true,phase:'transfer',inFlight:1,loadKg:33,current:100,voltage:24,joints:'[0.5]'},components:{robot:{}}},before=JSON.stringify(record);
 assert(circuits.supports(description));assert(!circuits.supports({...description,type:'vehicle'}));assert(!circuits.supports({...description,joints:[]}));
 assert.deepEqual(circuits.jointValue(description,record,'J1'),{value:.5,unit:'rad',source:'simulación actual'});
 assert.deepEqual(circuits.jointValue(description,null,'J1'),{value:.25,unit:'rad',source:'pose capturada'});
 assert.equal(circuits.jointValue(description,record,'J7'),null);assert(!('current' in circuits.currentState(record)));assert(!('voltage' in circuits.currentState(record)));
 assert.equal(JSON.stringify(record),before);
 assert.equal(circuits.jointValue(description,{variables:{joints:'[NaN]'}},'J1').value,.25);
 assert.equal(circuits.jointValue(description,{variables:{joints:'['+'0,'.repeat(3000)+'0]'}},'J1').value,.25);
 assert(!('loadKg' in circuits.currentState({variables:{loadKg:NaN}})));
});

class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.attributes={};this.hidden=false;this.value='';this._text='';this.style={};}
 set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}get textContent(){return this._text;}
 appendChild(child){child.parentNode=this;this.children.push(child);return child;}
 remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}
 addEventListener(key,fn){if(!this.listeners.has(key))this.listeners.set(key,new Set());this.listeners.get(key).add(fn);}
 fire(key,event={}){for(const fn of this.listeners.get(key)||[])fn({preventDefault(){},...event});}
 focus(){this.focused=true;}scrollIntoView(){this.scrolled=true;}
}
const all=root=>[root,...root.children.flatMap(all)];
const raw=fs.readFileSync(new URL('../../modules/logistica-industrial/functions/presentacion/runtime/RobotCircuitPanel.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export const ROBOT_CIRCUIT_STYLE','const ROBOT_CIRCUIT_STYLE').replace('export default class RobotCircuitPanel','class RobotCircuitPanel');
const {RobotCircuitPanel,ROBOT_CIRCUIT_STYLE}=new Function('circuits','learning',raw+'\nreturn {RobotCircuitPanel,ROBOT_CIRCUIT_STYLE};')(circuits,learning);

test('native circuit UI follows wires/pins across sheets and actual J1-J6 without source edits; animation and resources are bounded',async()=>{
 const model=new Document({}),world=new THREE.Group();model.registerRoom('hall',world);const actor=model.addPrefab('hall','robot'),description=catalog.describe(actor,model),authored=await model.serialize(),matrices=[];actor.traverse(mesh=>matrices.push([mesh.uuid,mesh.matrix.toArray(),mesh.position.toArray()]));
 const document={createElement:tag=>new Element(tag),hidden:false},host=new Element('div'),timers=new Map(),window={setInterval(fn){const id=timers.size+1;timers.set(id,fn);return id;},clearInterval(id){timers.delete(id);}},record={variables:{powered:true,running:false,phase:'idle',loadKg:0,joints:JSON.stringify([.1,.2,.3,.4,.5,.6])},components:{robot:{}}},highlights=[],photos=[];
 const panel=new RobotCircuitPanel({document,host,description,getRecord:()=>record,getObject:()=>actor,window,onHighlight:request=>highlights.push(request),onReference:ref=>photos.push(ref)}).mount();
 assert.equal(panel.viewId,'cabinet');assert.equal(panel.wireNodes.size,circuits.VIEWS.cabinet.routes.length);assert.equal(panel.terminalNodes.size,Object.keys(circuits.VIEWS.cabinet.ports).length);assert.equal(panel.axisSelect.children.length,6);assert.equal(highlights.length,0);
 for(const viewId of ['cabinet','robot','tool']){panel.setView(viewId);const view=circuits.VIEWS[viewId];for(const [id,port]of Object.entries(view.ports))if(port.side==='top'&&!id.startsWith('TB24.')){const label=all(panel.diagram).find(n=>n.getAttribute('data-circuit-label')===id);assert(label&&Number(label.getAttribute('y'))<port.y,'Top terminal label must not be drawn over the device title: '+id);}if(viewId==='robot'){const title=all(panel.diagram).find(n=>n.getAttribute('data-circuit-device-title')==='E1');assert(Number(title.getAttribute('x'))>620,'Encoder title leaves the first feedback terminal readable.');}}
 panel.setView('cabinet');
 panel.wireNodes.get('W24_PLC').group.fire('keydown',{key:'Enter'});assert.equal(panel.selectedWire,'W24_PLC');assert.equal(panel.wireNodes.get('W24_PLC').group.getAttribute('aria-pressed'),'true');assert(panel.selection.focused);
 panel.selectWire('W_U');all(panel.selection).find(n=>n.textContent==='Ubicar mazo / zona en equipo 3D').fire('click');assert.equal(highlights.length,1);assert.deepEqual(highlights[0].componentIds,['robot.harness','robot.base-services']);highlights.length=0;
 assert(panel.selectWire('W_ENC_AP'));assert.equal(panel.viewId,'robot');assert.equal(panel.selectedWire,'W_ENC_AP');assert.equal(panel.wireNodes.get('W_ENC_AP').path.getAttribute('opacity'),'1');assert.equal(panel.wireNodes.get('W_U').path.getAttribute('opacity'),'0.26');
 panel.terminalNodes.get('E1.A+').group.fire('click');assert.equal(panel.selectedTerminal,'E1.A+');assert.equal(panel.detailComponent,'E1');assert(all(panel.selection).some(n=>n.textContent==='W_ENC_AP · Encoder · A+'));assert(all(panel.componentHost).some(n=>n.tagName==='IMG'),'Selected electronics use existing official real reference photos.');
 assert(panel.selectComponent('M1'));for(const joint of description.joints){panel.axisSelect.value=joint.jointId;panel.axisSelect.fire('change');assert(panel.jointState.textContent.includes(joint.jointId));assert(!panel.evidence.textContent.includes('· 0 superficies'),'Selected native joint has actual matching housing/transmission surfaces.');}
 const relate=all(panel.componentHost).find(n=>n.tagName==='BUTTON'&&n.textContent==='Relacionar con el equipo 3D existente');relate.fire('click');assert.equal(highlights.length,1);assert.equal(highlights[0].jointId,'J6');assert.equal(highlights[0].conceptual,true);
 assert(panel.selectWire('W_COIL'));assert.equal(panel.viewId,'tool');assert.equal(panel.detailComponent,'Y1');assert(panel.selectTerminal('IO1.CONFIRM'));assert.equal(panel.detailComponent,'IO1');assert(!panel.selectWire('not-a-wire'));assert(!panel.selectTerminal('not-a-pin'));assert(!panel.setView('unknown'));assert(!panel.selectComponent('unknown'));
 panel.selectComponent('E1');const enlarge=all(panel.componentHost).find(n=>n.tagName==='BUTTON'&&n.textContent==='Ampliar referencia real');assert(enlarge);enlarge.fire('click');assert.equal(photos.length,1);assert(learning.safeLocalImage(photos[0].localPath));
 panel.setStep(0);assert(panel.play());assert.equal(timers.size,1);host.hidden=true;[...timers.values()][0]();assert.equal(panel.stepIndex,0,'Hidden panel never advances explanation.');host.hidden=false;for(let i=0;i<7;i++)[...timers.values()][0]();assert.equal(panel.stepIndex,6);assert.equal(timers.size,0);assert.equal(panel.playing,false);
 record.variables.phase='transit';record.variables.loadKg=33;panel.refresh();assert(all(panel.state).some(n=>n.textContent==='Carga: 33 kg'));assert(!all(panel.root).some(n=>n.tagName==='IFRAME'));assert(ROBOT_CIRCUIT_STYLE.includes('prefers-reduced-motion'));assert(ROBOT_CIRCUIT_STYLE.includes('max-width:520px'));
 assert.deepEqual(await model.serialize(),authored,'Wire browsing and teaching animation cannot author or command the machine.');const after=[];actor.traverse(mesh=>after.push([mesh.uuid,mesh.matrix.toArray(),mesh.position.toArray()]));assert.deepEqual(after,matrices);
 assert(panel.play());assert.equal(timers.size,1);panel.dispose();assert.equal(timers.size,0);assert.equal(host.children.length,0);assert.equal(panel.wireNodes.size,0);assert(!panel.selectWire('W_U'));panel.dispose();
});
