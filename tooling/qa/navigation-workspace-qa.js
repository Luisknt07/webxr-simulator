const __layout = require("../layout.cjs");
'use strict';
// Reusable browser checks. The caller owns an isolated store/profile and CDP.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
function installFixture() {
  const e = context.editor, d = e.document, a = e.assembly;
  const id = object => object.userData.editorId, machines = [], followers = [];
  const add = type => { const object = d.addPrefab(e.roomId, type, type === 'conveyor' ? 'roller-middle' : undefined); d.setBehaviors(object, d.getBehaviors(object).map(config => config.type === type ? Object.assign({}, config, {withPanel: false, withSensors: false, autoGenerate: false, initialCount: 0, autoSpawn: false}) : config)); d.setTransform(object, {position: [0, 1, -15]}); machines.push(object); return object; };
  const source = add('source'), first = add('conveyor'), second = add('conveyor'), stock = add('palletQueue');
  d.begin(); for (const [from,to] of [[source,first],[first,second],[second,stock]]) { a.align(from,'output',to,'input'); a.connect(a.pair(to,'input',from,'output')); } d.commit();
  const monitor = d.addPrimitive(e.roomId,'box'); d.setTransform(monitor,{position:[2,2,-12],scale:[3.2,1.8,.12]}); d.setBehaviors(monitor,[{type:'lineMonitor',targetId:id(first),scope:'line'}]); followers.push(monitor);
  const stand=d.addPrimitive(e.roomId,'box');d.setTransform(stand,{position:[2,.5,-12],scale:[.12,1,.12]});followers.push(stand);
  d.setStudio({groups:(d.studio.groups||[]).concat({id:'navigation-line',name:'QA connected line',roomId:e.roomId,members:machines.concat(followers).map(id)})});
  const all=machines.concat(followers), primary=id(first), ids=all.map(id), before=new Map(ids.map(value=>[value,d.getObject(value).getWorldPosition(e.camera.position.clone()).toArray()]));
  const pose=object=>object.getWorldPosition(e.camera.position.clone()).toArray();
  const q={primary,source:id(source),second:id(second),stock:id(stock),ids,machineIds:machines.map(id)};
  q.frame=()=>{const object=d.getObject(primary);e.select(object);e.setTool('translate');e.stopOrbitMotion();const center=object.getWorldPosition(e.camera.position.clone());e.camera.position.copy(center).add(center.clone().set(4,3.5,7));e.orbit.target.copy(center);e.safeCameraPosition=null;e.safeOrbitTarget=null;e.orbit.update();e.render(0);return true;};
  q.pointer=()=>{q.frame();const gizmo=e.transform.children.find(node=>node.picker),picker=gizmo&&gizmo.picker.translate;if(!picker)throw new Error('Missing real TransformControls picker');const rect=context.renderer.domElement.getBoundingClientRect();for(const mesh of picker.children.filter(node=>node.name==='X')){if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;for(let sample=2;sample<=8;sample++){const point=box.min.clone().lerp(box.max,sample/10).applyMatrix4(mesh.matrixWorld).project(e.camera);e.transform.pointerHover({x:point.x,y:point.y,button:0});if(e.transform.axis==='X')return{x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2};}}throw new Error('X gizmo has no reachable point');};
  q.snapshot=()=>({dragging:e.transform.dragging,component:!!a.drag?.component,detach:!!a.drag?.detach,hint:e.assemblyHint.textContent,poses:ids.map(value=>({id:value,position:pose(d.getObject(value))})),links:machines.map(object=>{const live=d.getObject(id(object));return{id:id(live),config:a.config(live)};}),undo:d.undoStack.length});
  q.assertMoved=component=>{const values=q.snapshot(),primaryPose=values.poses.find(value=>value.id===primary).position,initial=before.get(primary),delta=primaryPose.map((value,index)=>value-initial[index]);if(Math.hypot(...delta)<.02)throw new Error('Gizmo drag did not move the selected machine');values.poses.forEach(value=>{const expected=component?delta:value.id===primary?delta:[0,0,0],original=before.get(value.id);if(value.position.some((n,index)=>Math.abs(n-original[index]-expected[index])>1e-5))throw new Error('Wrong component drag ownership: '+value.id);});return values;};
  q.restore=async()=>{await e.perform(()=>e.historyStep('undo'));q.frame();return true;};
  q.frame();window.__navigationQA=q;return q.snapshot();
}
module.exports=async function navigationWorkspaceQA({evaluate,send,shot,until,delay}){
  try {
  await evaluate('(async()=>{const e=context.editor;await e.studioTools.newScene({name:"QA navigation"});e.shell.setPanel("resources",false);return true})()');
  const fixture=await evaluate('('+installFixture.toString()+')()'),before=await evaluate('(async()=>context.editor.document.serialize())()');
  const drag=async(modifiers=0)=>{const p=await evaluate('__navigationQA.pointer()');await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:p.x,y:p.y,modifiers});await send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:p.x+65,y:p.y,modifiers});return p;};
  let p=await drag(),moving=await evaluate('__navigationQA.assertMoved(true)');assert(moving.component&&moving.dragging);await shot('navigation-line-drag');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:p.x+65,y:p.y});await until(()=>evaluate('!context.editor.pendingEdits'),'Drag did not commit');await evaluate('__navigationQA.restore()');assert.deepEqual(await evaluate('(async()=>context.editor.document.serialize())()'),before);
  p=await drag(2);const detached=await evaluate('__navigationQA.assertMoved(false)');assert(detached.detach&&!detached.component);const source=detached.links.find(value=>value.id===fixture.links[0].id);assert.equal(source.config.outputId,'');await shot('navigation-ctrl-detach');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:p.x+65,y:p.y,modifiers:2});await until(()=>evaluate('!context.editor.pendingEdits'),'Ctrl drag did not commit');await evaluate('__navigationQA.restore()');assert.deepEqual(await evaluate('(async()=>context.editor.document.serialize())()'),before);
  const zoomBefore=await evaluate('(()=>{const e=context.editor;e.stopOrbitMotion();e.pendingZoom=0;const r=context.renderer.domElement.getBoundingClientRect();return{distance:e.camera.position.distanceTo(e.orbit.target),x:r.left+r.width*.75,y:r.top+r.height*.5}})()');await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:zoomBefore.x,y:zoomBefore.y,deltaX:0,deltaY:120});await delay(350);const zoomAfter=await evaluate('context.editor.camera.position.distanceTo(context.editor.orbit.target)');assert(zoomAfter>zoomBefore.distance&&zoomAfter<zoomBefore.distance*Math.exp(.15));
  await evaluate('context.editor.leave();context.editor.simulationPaused=true;context.studioLocomotion="teleport"');await until(()=>evaluate('!context.studio.header.hidden'),'Public navigation toolbar did not open');
  const toggle=await evaluate('(()=>{const r=context.studio.flightButton.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()');await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:toggle.x,y:toggle.y});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:toggle.x,y:toggle.y});assert(await evaluate('context.desktopFlight&&context.studio.flightButton.getAttribute("aria-pressed")==="true"&&context.studioLocomotion==="teleport"'));
  const fly=async(boost)=>{const before=await evaluate('context.camera.getWorldPosition(context.camera.position.clone()).y');if(boost)await send('Input.dispatchKeyEvent',{type:'keyDown',code:'ControlLeft',key:'Control',windowsVirtualKeyCode:17,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyQ',key:'q',windowsVirtualKeyCode:81,modifiers:boost?2:0});await delay(300);await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyQ',key:'q',windowsVirtualKeyCode:81});if(boost)await send('Input.dispatchKeyEvent',{type:'keyUp',code:'ControlLeft',key:'Control',windowsVirtualKeyCode:17});const after=await evaluate('context.camera.getWorldPosition(context.camera.position.clone()).y');assert(after>before+.02);return after-before;};
  const normalRise=await fly(false),boostRise=await fly(true);await shot('navigation-drone');
  console.log('Chrome navigation: flight passed; restoring editor');
  await evaluate('context.studio.setDesktopFlight(false);context.editor.enter();true');
  console.log('Chrome navigation: editor restored; checking authored state');
  assert.deepEqual(await evaluate('(async()=>context.editor.document.serialize())()'),before);
  return{realGizmo:true,componentMoving:true,ctrlDetach:true,atomicUndo:true,zoom:{before:zoomBefore.distance,after:zoomAfter},flight:{normalRise,boostRise,teleportPreferencePreserved:true},authoredUnchanged:true};
  } catch(error) {
    const snapshot=await evaluate('window.__navigationQA?.snapshot()').catch(()=>null);
    fs.writeFileSync(__layout.map(path.join(__layout.oldDir("scripts/navigation-workspace-qa.js"),'../data/qa-studio/navigation-workspace-failure.json')),JSON.stringify({message:error.message,snapshot},null,2));
    await shot('navigation-failure').catch(()=>{});throw error;
  }
};
