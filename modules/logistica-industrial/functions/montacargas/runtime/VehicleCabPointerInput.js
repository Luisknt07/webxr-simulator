import * as THREE from 'three';

const clamp=value=>Math.max(-1,Math.min(1,value));
const NAMES={steer:'Volante',lift:'Elevación',tilt:'Inclinación',reach:'Alcance',sideShift:'Desplazamiento lateral',turret:'Torreta',horn:'Bocina',ignition:'Contacto: arrancar / apagar',lights:'Luces',parkingBrake:'Freno de estacionamiento',emergency:'Parada de emergencia',resetEmergency:'Rearmar (después pulsa contacto)',throttle:'Acelerador',brake:'Freno'};

/** Native mesh picking and captured, multi-pointer drags. It only supplies
 * input to the existing cab/runtime; it never moves the vehicle or camera. */
export default class VehicleCabPointerInput {
 constructor(cab){
  this.cab=cab;this.driving=cab.driving;this.ctx=cab.ctx;this.states=new Map();this.listeners=[];this.ray=new THREE.Raycaster();this.hover=null;
  this.canvas=this.ctx.renderer&&this.ctx.renderer.domElement;this.dom=this.driving.document;this.win=this.driving.window;
  if(!this.canvas||!this.canvas.addEventListener||!this.canvas.getBoundingClientRect)return;
  const listen=(target,type,handler)=>{if(!target||!target.addEventListener)return;target.addEventListener(type,handler,{capture:true,passive:false});this.listeners.push(()=>target.removeEventListener(type,handler,true));};
  listen(this.canvas,'pointerdown',event=>this.down(event));
  listen(this.win||this.canvas,'pointermove',event=>this.move(event));
  for(const type of ['pointerup','pointercancel'])listen(this.win||this.canvas,type,event=>this.up(event));
  listen(this.canvas,'lostpointercapture',event=>this.up(event));
 }
 active(){return !!(this.driving.id&&!this.ctx.vrMode&&!this.driving.blocked());}
 project(point){const rect=this.canvas.getBoundingClientRect(),p=point.clone().project(this.ctx.camera);return{x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2,z:p.z};}
 controlFor(object){for(let node=object;node;node=node.parent){const control=this.cab.controls.find(value=>value.object===node);if(control)return control;}return null;}
 meshes(){const list=[];if(this.cab.root)this.cab.root.traverseVisible(node=>{if(node.isMesh&&!node.userData.editorRuntimeHelper)list.push(node);});return list;}
 pick(event){
  if(!this.active())return null;const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;
  const locked=this.dom&&this.dom.pointerLockElement===this.canvas,x=locked?rect.left+rect.width/2:event.clientX,y=locked?rect.top+rect.height/2:event.clientY;
  this.ctx.camera.updateWorldMatrix(true,false);this.ctx.camera.updateMatrixWorld(true);this.ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),this.ctx.camera);
  this.cab.root.updateWorldMatrix(true,true);const meshes=this.meshes(),hit=this.ray.intersectObjects(meshes,false)[0];
  if(hit){const control=this.controlFor(hit.object);if(control)return{control,x,y};}
  // A touch target can be a little wider than the visible knob. Check the
  // actual sight line first so hidden controls cannot be operated through it.
  if(event.pointerType==='touch'){
   let nearest=null,distance=24;for(const control of this.cab.controls){const p=this.project(control.descriptor.grip.getWorldPosition(new THREE.Vector3())),d=Math.hypot(p.x-x,p.y-y);if(p.z>=-1&&p.z<=1&&d<distance){nearest=control;distance=d;}}
   if(nearest){const point=nearest.descriptor.grip.getWorldPosition(new THREE.Vector3()),direction=point.clone().sub(this.ray.ray.origin).normalize();this.ray.set(this.ray.ray.origin,direction);const first=this.ray.intersectObjects(meshes,false)[0];if(first&&this.controlFor(first.object)===nearest)return{control:nearest,x,y};}
  }
  return null;
 }
 stop(event){event.preventDefault();if(event.stopImmediatePropagation)event.stopImmediatePropagation();}
 down(event){
  if(event.button!==undefined&&event.button!==0||this.states.has(event.pointerId))return;const hit=this.pick(event);if(!hit||!this.cab.canTake(hit.control))return;
  this.stop(event);const control=hit.control,point=control.descriptor.grip.getWorldPosition(new THREE.Vector3());this.cab.frame(control);
  const state={pointer:true,id:event.pointerId,control:null,startX:hit.x,startY:hit.y,x:hit.x,y:hit.y,previousX:hit.x,previousY:hit.y};this.states.set(event.pointerId,state);
  if(!this.cab.take(state,control,point)){this.states.delete(event.pointerId);return;}
  if(!this.states.has(event.pointerId))return; // A stop command can reset input.
  state.startValue=control.value;state.center=this.project(control.object.getWorldPosition(new THREE.Vector3()));state.angle=Math.atan2(-(hit.y-state.center.y),hit.x-state.center.x);state.rotation=control.value*(control.descriptor.maxAngle||1.25);
  const projected=this.project(point.clone().add(new THREE.Vector3().fromArray(control.descriptor.axis||[0,0,1]).transformDirection(control.frame).multiplyScalar(control.descriptor.travel||.06))),origin=this.project(point),dx=projected.x-origin.x,dy=projected.y-origin.y,length=Math.hypot(dx,dy);
  state.axis=length>5?{x:dx/length,y:dy/length}:{x:0,y:-1};state.travel=Math.max(32,length);
  this.ctx.vehicleCabPointerActive=true;try{this.canvas.setPointerCapture(event.pointerId);}catch(_){}this.caption(control,event);this.cursor('grabbing');
 }
 move(event){
  const state=this.states.get(event.pointerId);
  if(!state){if(event.target===this.canvas&&this.active()){const hit=this.pick(event);this.setHover(hit&&hit.control,event);}else if(!this.states.size)this.setHover(null);return;}
  this.stop(event);if(!this.active()||event.pointerType!=='touch'&&event.buttons===0){this.up(event);return;}
  const locked=this.dom&&this.dom.pointerLockElement===this.canvas;state.x=locked?state.x+(event.movementX||0):event.clientX;state.y=locked?state.y+(event.movementY||0):event.clientY;
  const c=state.control;if(!c)return;
  if(c.kind==='wheel'){const angle=Math.atan2(-(state.y-state.center.y),state.x-state.center.x);let delta=angle-state.angle;if(delta>Math.PI)delta-=Math.PI*2;if(delta<-Math.PI)delta+=Math.PI*2;state.rotation=clamp((state.rotation+delta)/(c.descriptor.maxAngle||1.25))*(c.descriptor.maxAngle||1.25);state.angle=angle;this.cab.setValue(c,state.rotation/(c.descriptor.maxAngle||1.25));}
  else if(c.kind==='lever')this.cab.setValue(c,clamp(state.startValue+((state.x-state.startX)*state.axis.x+(state.y-state.startY)*state.axis.y)/state.travel));
  this.caption(c,{clientX:state.x,clientY:state.y});
 }
 up(event){const state=this.states.get(event.pointerId);if(!state)return;this.stop(event);this.states.delete(event.pointerId);this.cab.release(state);try{if(this.canvas.hasPointerCapture&&this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);}catch(_){}this.ctx.vehicleCabPointerActive=this.states.size>0;if(!this.states.size){this.setHover(null);this.cursor('');}}
 setHover(control,event){if(this.hover)this.hover.pointerHover=false;this.hover=control||null;if(control){control.pointerHover=true;this.caption(control,event);this.cursor(control.kind==='button'||control.kind==='pedal'?'pointer':'grab');}else if(!this.states.size){if(this.hint)this.hint.hidden=true;this.cursor('');}this.cab.syncLabels();}
 caption(control,event){if(!this.dom||!this.dom.body||!this.dom.createElement)return;if(!this.hint){this.hint=this.dom.createElement('div');this.hint.className='vehicle-cab-pointer-hint';this.hint.style.cssText='position:fixed;z-index:75;pointer-events:none;max-width:250px;padding:7px 10px;border:1px solid #82cbb8;border-radius:7px;background:#142d38f2;color:#e7fff7;font:12px/1.4 system-ui';this.dom.body.appendChild(this.hint);}this.hint.textContent=(NAMES[control.channel]||control.channel)+' · '+(control.kind==='button'?'Pulsar':control.kind==='pedal'?'Mantener; soltar para detener':'Arrastrar; soltar para dejar en neutro');this.hint.hidden=false;this.hint.style.left=Math.max(8,Math.min((this.win&&this.win.innerWidth||1024)-265,(event&&event.clientX||0)+16))+'px';this.hint.style.top=Math.max(8,Math.min((this.win&&this.win.innerHeight||768)-65,(event&&event.clientY||0)+18))+'px';}
 cursor(value){if(this.canvas&&this.canvas.style)this.canvas.style.cursor=value;}
 reset(){const states=[...this.states.values()];this.states.clear();for(const state of states){this.cab.release(state);try{if(this.canvas&&this.canvas.hasPointerCapture&&this.canvas.hasPointerCapture(state.id))this.canvas.releasePointerCapture(state.id);}catch(_){}}this.ctx.vehicleCabPointerActive=false;this.setHover(null);}
 dispose(){this.reset();this.listeners.splice(0).forEach(off=>off());if(this.hint)this.hint.remove();this.hint=null;}
}
