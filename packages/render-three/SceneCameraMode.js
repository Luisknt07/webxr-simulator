import * as THREE from 'three';
const CAPSULE={radius:.25,height:1.6,eyeHeight:1.6};
const scope=ctx=>[ctx.room,ctx.editor&&ctx.editor.roomId,ctx.editor&&ctx.editor.projectGeneration].join(':');
export function getSceneCameraMode(ctx={}){
 const editor=ctx.editor,mode=ctx.vrMode?'xr':ctx.drivingVehicle?'vehicle':ctx.desktopFlight?'drone':'walk';
 const reason=ctx.vrMode?'El visor usa su cámara y controles de realidad virtual.':ctx.drivingVehicle?'Baja del vehículo para cambiar la cámara.':ctx.roomTransition||editor&&(editor.active||editor.initializing||editor.loadingProject)?'Termina de abrir la escena para cambiar la cámara.':'';
 return{mode,blocked:!!reason,reason};
}
/** Reuses the actual camera and native collision world; never detach XR/seat. */
export function setDroneFlight(ctx,enabled,{clearInput=()=>{},message=()=>{},walkingBounds=null}={}){
 const state=getSceneCameraMode(ctx);if(state.blocked){message(state.reason);return false;}
 const camera=ctx.camera,rig=ctx.cameraRig;if(!camera||!camera.position||!camera.getWorldPosition){message('La cámara de la escena aún no está disponible.');return false;}
 enabled=!!enabled;if(enabled===!!ctx.desktopFlight)return true;
 if(rig&&rig.updateWorldMatrix)rig.updateWorldMatrix(true,true);else camera.updateWorldMatrix(true,false);
 const current=camera.getWorldPosition(new THREE.Vector3()),world=ctx.collisionWorld;
 if(walkingBounds&&!['minX','maxX','minZ','maxZ'].every(key=>Number.isFinite(walkingBounds[key]))){message('El límite peatonal de esta escena no es válido.');return false;}
 const margin=CAPSULE.radius+(walkingBounds&&Number.isFinite(walkingBounds.thickness)?Math.max(0,walkingBounds.thickness)/2:0)+.003;
 const inBounds=point=>!walkingBounds||point.x>=walkingBounds.minX+margin&&point.x<=walkingBounds.maxX-margin&&point.z>=walkingBounds.minZ+margin&&point.z<=walkingBounds.maxZ-margin;
 if(enabled){ctx.desktopFlightAnchor={position:current.clone(),scope:scope(ctx),document:ctx.editor&&ctx.editor.document,parent:camera.parent};}
 else if(world&&typeof world.canOccupyCapsule==='function'){
  const anchor=ctx.desktopFlightAnchor,matching=anchor&&anchor.scope===scope(ctx)&&anchor.document===(ctx.editor&&ctx.editor.document)&&anchor.parent===camera.parent;
  const standing=point=>inBounds(point)&&world.canOccupyCapsule(point,CAPSULE),supported=point=>typeof world.rayBlocked!=='function'||world.rayBlocked(point,point.clone().add(new THREE.Vector3(0,-1.7,0)));
  let destination=null;if(standing(current)&&supported(current))destination=current;
  if(!destination&&matching){const below=new THREE.Vector3(current.x,anchor.position.y,current.z);if(standing(below)&&supported(below))destination=below;else if(standing(anchor.position)&&supported(anchor.position)){destination=anchor.position;message('Regresas al punto de acceso peatonal desde el que activaste el dron.');}}
  if(!destination){message('No hay un apoyo peatonal libre debajo. Vuela hacia un pasillo despejado antes de volver a Caminar.');return false;}
  if(destination.distanceToSquared(current)>1e-10)camera.position.copy(camera.parent?camera.parent.worldToLocal(destination.clone()):destination);
 }
 clearInput();if(ctx.mobileNavigation&&ctx.mobileNavigation.reset)ctx.mobileNavigation.reset('camera-mode');if(ctx.desktopLook&&ctx.desktopLook.reset)ctx.desktopLook.reset();
 ctx.desktopFlight=enabled;if(!enabled)ctx.desktopFlightAnchor=null;if(ctx.resetCollisionPose)ctx.resetCollisionPose();if(rig&&rig.updateWorldMatrix)rig.updateWorldMatrix(true,true);
 return true;
}
