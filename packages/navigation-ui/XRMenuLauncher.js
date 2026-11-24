import * as THREE from 'three';

let serial=0;
/** Two measured hands: wrist entry. One hand, or tracked controllers without
 * the X/A/Y shortcut: reachable body entry. Tracking loss never keeps a pose. */
export default class XRMenuLauncher {
  constructor(ctx,{open,isOpen=()=>false,enabled=()=>true}={}) {
    this.ctx=ctx;this.open=open;this.isOpen=isOpen;this.enabled=enabled;this.name='xr-hand-menu-'+(++serial);
    this.point=new THREE.Vector3();this.eye=new THREE.Vector3();this.forward=new THREE.Vector3();this.right=new THREE.Vector3();
  }
  ensure() {
    if(this.mesh){const ray=this.ctx.raycontrol;if(!ray.states[this.name])ray.addState(this.name,this.state,true);else if(ray.states[this.name]===this.state)ray.activateState(this.name);return true;}
    const dom=this.ctx.document||(typeof document==='undefined'?null:document);if(!dom)return false;
    const canvas=dom.createElement('canvas');canvas.width=512;canvas.height=192;const d=canvas.getContext('2d');if(!d)return false;
    d.fillStyle='#0a303d';d.fillRect(0,0,512,192);d.strokeStyle='#75e6ce';d.lineWidth=8;d.strokeRect(4,4,504,184);
    d.fillStyle='#eafffa';d.textAlign='center';d.font='bold 60px sans-serif';d.fillText('Menú RV',256,85);d.font='30px sans-serif';d.fillText('Apunta, pulsa o toca',256,145);
    this.texture=new THREE.CanvasTexture(canvas);this.texture.encoding=THREE.sRGBEncoding;this.texture.generateMipmaps=false;this.texture.minFilter=THREE.LinearFilter;
    this.mesh=new THREE.Mesh(new THREE.PlaneBufferGeometry(.20,.075),new THREE.MeshBasicMaterial({map:this.texture,toneMapped:false,transparent:true,depthTest:false,depthWrite:false}));
    this.mesh.name='Menú RV · acceso con manos';this.mesh.renderOrder=10001;this.mesh.frustumCulled=false;this.mesh.userData={editorRuntimeHelper:true,editorNonCollidable:true};this.ctx.scene.add(this.mesh);
    this.state={xrMenu:true,handTouchable:true,controller:'both',vrOnly:true,raycaster:true,order:-30,captureSelect:true,consumeSelect:true,colliderMesh:this.mesh,
      isSelectable:(hit,controller)=>!!(this.mesh.visible&&!this.isOpen()&&hit&&hit.distance<=2&&!(controller&&controller.userData&&controller.userData.xrDirectTouch&&controller.controller===this.owner)),
      onSelectStart:()=>{if(this.mesh.visible&&!this.isOpen()){this.mesh.visible=false;this.open();}}};
    this.ctx.raycontrol.addState(this.name,this.state,true);return true;
  }
  update() {
    if(this.disposed)return;
    const ctx=this.ctx,xr=ctx.renderer&&ctx.renderer.xr,session=xr&&xr.getSession&&xr.getSession(),editor=ctx.editor;
    const blocked=!this.enabled()||!ctx.vrMode||!session||session.visibilityState&&session.visibilityState!=='visible'||this.isOpen()||ctx.voicePanelOpen||ctx.assistantPanelOpen||ctx.publicDialogOpen||ctx.xrEntryPending||ctx.xrExitPending||ctx.roomTransition||editor&&(editor.active||editor.loadingProject||editor.initializing);
    const hands=!blocked&&(ctx.raycontrol.controllers||[]).filter(data=>!data.desktop&&data.enabled!==false&&data.inputSource&&data.inputSource.hand&&data.controller.userData.xrHandContact&&data.controller.userData.xrHandContact.pokeValid&&!data.controller.userData.vehicleCabGrip);
    const controllers=!blocked&&(ctx.raycontrol.controllers||[]).filter(data=>!data.desktop&&data.enabled!==false&&data.controller.visible!==false&&data.inputSource&&!data.inputSource.hand&&['left','right'].includes(data.inputSource.handedness)&&!data.controller.userData.vehicleCabGrip);
    const face=controllers&&controllers.some(data=>{const source=data.inputSource,pad=source.gamepad;return(!ctx.drivingVehicle||source.handedness==='left')&&pad&&pad.mapping==='xr-standard'&&pad.buttons&&pad.buttons[ctx.drivingVehicle?5:4];});
    if(!hands||!hands.length&&(!controllers.length||face)){if(this.mesh)this.mesh.visible=false;return;}
    if(!this.ensure())return;
    const camera=xr.getCamera?xr.getCamera(ctx.camera):ctx.camera;ctx.cameraRig.updateWorldMatrix(true,true);this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.forward.set(0,0,-1).transformDirection(camera.matrixWorld);this.forward.y=0;if(this.forward.lengthSq()<.01)this.forward.set(0,0,-1);this.forward.normalize();this.right.crossVectors(this.forward,new THREE.Vector3(0,1,0));
    this.owner=null;
    if(hands.length>1){const hand=hands.find(data=>data.inputSource.handedness==='left')||hands[0],controller=hand.controller,parent=controller.userData.gripObject&&controller.userData.gripObject.parent||controller.parent;
      this.owner=controller;this.point.copy(controller.userData.xrHandContact.wrist).applyMatrix4(parent.matrixWorld).addScaledVector(this.right,-.14);this.point.y+=.045;
    }else{this.point.copy(this.eye).addScaledVector(this.forward,.55).addScaledVector(this.right,-.28);this.point.y-=.30;}
    this.mesh.position.copy(this.ctx.scene.worldToLocal(this.point.clone()));this.mesh.lookAt(this.eye);this.mesh.visible=true;this.mesh.updateWorldMatrix(true,false);
  }
  releaseResources() {
    const ray=this.ctx.raycontrol;if(this.state&&ray.states[this.name]===this.state){ray.deactivateState(this.name);delete ray.states[this.name];}
    if(this.mesh){this.mesh.parent.remove(this.mesh);this.mesh.geometry.dispose();this.mesh.material.dispose();this.texture.dispose();this.mesh=null;}this.state=null;
  }
  dispose() {if(this.disposed)return;this.disposed=true;this.releaseResources();}
}
