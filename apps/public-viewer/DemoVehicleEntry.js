import * as THREE from 'three';

/** Visible, ray-selectable boarding in the public XR scene, where the HTML
 * menu cannot be used from a headset. Controls stay attached to the vehicle. */
export default class DemoVehicleEntry {
 constructor(ctx,simulation,driving){this.ctx=ctx;this.simulation=simulation;this.driving=driving;this.entries=new Map();this.name=simulation.statePrefix+'public-vehicle-entry';this.eye=new THREE.Vector3();this.point=new THREE.Vector3();}
 sync(){
  const ctx=this.ctx,driving=this.driving;
  if(!ctx.vrMode&&!this.entries.size)return;
  if(!this.state){
   const canvas=globalThis.document.createElement('canvas');canvas.width=768;canvas.height=192;const text=canvas.getContext('2d');text.fillStyle='#123842';text.fillRect(0,0,768,192);text.strokeStyle='#8ce9bd';text.lineWidth=8;text.strokeRect(4,4,760,184);text.fillStyle='#f1fffc';text.textAlign='center';text.font='bold 45px sans-serif';text.fillText('Subir y arrancar',384,79);text.font='29px sans-serif';text.fillText('Pulsa · listo para conducir',384,137);
   this.texture=new THREE.CanvasTexture(canvas);this.texture.encoding=THREE.sRGBEncoding;this.texture.minFilter=THREE.LinearFilter;this.texture.generateMipmaps=false;this.geometry=new THREE.PlaneBufferGeometry(.72,.18);this.material=new THREE.MeshBasicMaterial({map:this.texture,toneMapped:false});
   const allowed=hit=>{const plane=hit&&hit.object;return !!(ctx.vrMode&&!driving.id&&!driving.blocked()&&plane&&plane.visible&&this.simulation.records.has(plane.userData.vehicleEntryId)&&plane.getWorldPosition(this.point).distanceTo(this.eye)<=4.5);};
   this.state={controller:'both',vrOnly:true,raycaster:true,handTouchable:true,order:-5,consumeSelect:true,captureSelect:true,colliderMesh:[],isSelectable:allowed,onSelectEnd:hit=>{if(allowed(hit))driving.boardAndStart(hit.object.userData.vehicleEntryId);}};ctx.raycontrol.addState(this.name,this.state,true);
  }
  const camera=ctx.vrMode&&ctx.renderer.xr.getCamera?ctx.renderer.xr.getCamera(ctx.camera):ctx.camera;camera.updateWorldMatrix(true,false);this.eye.setFromMatrixPosition(camera.matrixWorld);
  for(const [id,entry]of this.entries)if(this.simulation.records.get(id)!==entry.record){entry.plane.parent.remove(entry.plane);this.entries.delete(id);}
  for(const record of this.simulation.records.values()){
   if(!record.components.vehicle)continue;let entry=this.entries.get(record.id);
   if(!entry){const root=driving.visual(record),rig=root&&root.userData.vehicleRig;if(!rig||!rig.driverSeat)continue;const plane=new THREE.Mesh(this.geometry,this.material);plane.name='Subir al montacargas · RV';plane.userData={editorRuntimeHelper:true,editorNonCollidable:true,vehicleEntryId:record.id};rig.driverSeat.add(plane);plane.position.set(0,.72,.05);entry={plane,record};this.entries.set(record.id,entry);}
   entry.plane.visible=!!(ctx.vrMode&&!driving.id&&!driving.blocked());if(entry.plane.visible){entry.plane.lookAt(this.eye);entry.plane.updateWorldMatrix(true,false);}
  }
  this.state.colliderMesh=[...this.entries.values()].map(entry=>entry.plane);
 }
 dispose(){for(const {plane}of this.entries.values())if(plane.parent)plane.parent.remove(plane);this.entries.clear();if(this.state){this.ctx.raycontrol.deactivateState(this.name);delete this.ctx.raycontrol.states[this.name];this.geometry.dispose();this.material.dispose();this.texture.dispose();}}
}
