import * as THREE from 'three';
import XRMenuLauncher from './XRMenuLauncher.js';

const W=1024,H=960;
let serial=0;
/** Bounded, native world-space navigation for the public viewer. No editor,
 * accounts, desktop overlay or arbitrary project loading enters this module. */
export default class XRSceneMenu {
  constructor(ctx,options={}) {
    this.ctx=ctx;this.options=options;this.name='xr-scene-menu-'+(++serial);this.opened=false;this.page='home';this.regions=[];this.presses=new Map();this.buttons=new WeakMap();
    this.eye=new THREE.Vector3();this.forward=new THREE.Vector3();this.target=new THREE.Vector3();
    this.launcher=new XRMenuLauncher(ctx,{open:()=>this.open(),isOpen:()=>this.opened});
    this.disconnected=event=>this.presses.delete(event&&event.controller);ctx.raycontrol.addEventListener('controllerDisconnected',this.disconnected);
  }
  ensure() {
    if(this.mesh){const ray=this.ctx.raycontrol;if(!ray.states[this.name])ray.addState(this.name,this.state,true);return true;}const dom=this.ctx.document||(typeof document==='undefined'?null:document);if(!dom)return false;
    this.canvas=dom.createElement('canvas');this.canvas.width=W;this.canvas.height=H;this.drawing=this.canvas.getContext('2d');if(!this.drawing)return false;
    this.texture=new THREE.CanvasTexture(this.canvas);this.texture.encoding=THREE.sRGBEncoding;this.texture.generateMipmaps=false;this.texture.minFilter=THREE.LinearFilter;
    this.mesh=new THREE.Mesh(new THREE.PlaneBufferGeometry(1.02,.956),new THREE.MeshBasicMaterial({map:this.texture,toneMapped:false,transparent:true,depthTest:false,depthWrite:false}));
    this.mesh.name='SMART-TWIN · menú RV del recorrido';this.mesh.userData={editorRuntimeHelper:true,editorNonCollidable:true};this.mesh.renderOrder=10000;this.mesh.frustumCulled=false;this.mesh.visible=false;this.ctx.scene.add(this.mesh);
    this.state={xrMenu:true,handTouchable:true,controller:'both',vrOnly:true,raycaster:true,order:-25,captureSelect:true,consumeSelect:true,colliderMesh:this.mesh,
      isSelectable:hit=>!!(this.opened&&this.mesh.visible&&hit&&hit.uv&&hit.distance<=5),
      onSelectStart:(hit,controller)=>this.press(hit,controller),onSelectEnd:(hit,controller)=>this.presses.delete(controller),onSelectCancel:(hit,controller)=>this.presses.delete(controller)};
    this.ctx.raycontrol.addState(this.name,this.state,true);return true;
  }
  neutral() {
    const ctx=this.ctx;if(ctx.input)ctx.input.reset();if(ctx.teleport)ctx.teleport.cancel();if(ctx.demo)ctx.demo.driving.resetInput();
    for(const data of ctx.raycontrol.controllers||[]){ctx.raycontrol.cancelSelect(data);ctx.raycontrol.clearHover(data);}
  }
  place() {
    const ctx=this.ctx;ctx.cameraRig.updateWorldMatrix(true,true);const camera=ctx.renderer.xr.getCamera?ctx.renderer.xr.getCamera(ctx.camera):ctx.camera;
    this.eye.setFromMatrixPosition(camera.matrixWorld);this.forward.set(0,0,-1).transformDirection(camera.matrixWorld);this.forward.y=0;if(this.forward.lengthSq()<.01)this.forward.set(0,0,-1);this.forward.normalize();
    this.target.copy(this.eye).addScaledVector(this.forward,1.3);this.target.y-=.08;this.mesh.position.copy(ctx.scene.worldToLocal(this.target));this.mesh.lookAt(this.eye);this.mesh.updateWorldMatrix(true,false);
  }
  open(page='home') {
    const session=this.ctx.renderer.xr.getSession();
    if(this.disposed||!this.ctx.vrMode||!session||session.visibilityState&&session.visibilityState!=='visible'||this.ctx.xrExitPending||!this.ensure())return false;
    if(this.options.beforeOpen)this.options.beforeOpen();if(this.ctx.demo&&this.ctx.demo.simulation&&this.ctx.demo.simulation.onInputModeChange)this.ctx.demo.simulation.onInputModeChange();this.neutral();this.opened=true;this.ctx.studioMenuOpen=true;this.page=page;this.error='';this.mesh.visible=true;
    this.ctx.raycontrol.activateState(this.name);this.place();this.paint();return true;
  }
  close() {
    this.opened=false;this.ctx.studioMenuOpen=false;this.presses.clear();if(this.mesh)this.mesh.visible=false;
    this.neutral();if(this.state)this.ctx.raycontrol.deactivateState(this.name);
  }
  press(hit,controller) {
    if(!this.opened||this.presses.has(controller)||!hit||!hit.uv)return;
    const x=hit.uv.x*W,y=(1-hit.uv.y)*H,region=this.regions.find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h);
    if(!region||region.disabled||[...this.presses.values()].includes(region.key))return;
    this.presses.set(controller,region.key);
    try{const result=region.action();if(result&&result.catch)result.catch(error=>{this.error=String(error.message||'No se pudo completar la acción.').slice(0,100);if(this.opened)this.paint();});}
    catch(error){this.error=String(error.message||'No se pudo completar la acción.').slice(0,100);}
    if(this.opened)this.paint();
  }
  text(value,x,y,size=30,color='#eafffa') {const d=this.drawing;d.fillStyle=color;d.font='600 '+size+'px sans-serif';d.textAlign='left';d.fillText(value,x,y);}
  wrap(value,y,size=30) {
    const d=this.drawing;d.font='600 '+size+'px sans-serif';let line='';
    for(const word of value.split(' ')){const next=line?line+' '+word:word;if(d.measureText(next).width>W-100&&line){this.text(line,50,y,size);y+=size*1.5;line=word;}else line=next;}
    if(line){this.text(line,50,y,size);y+=size*1.5;}return y+15;
  }
  button(key,label,x,y,w,h,action,disabled=false) {
    const d=this.drawing;d.fillStyle=disabled?'#1d3540':'#174a57';d.fillRect(x,y,w,h);d.strokeStyle=disabled?'#49616b':'#65cfbd';d.lineWidth=2;d.strokeRect(x,y,w,h);
    this.text(label,x+18,y+h/2+10,30,disabled?'#94a9b0':'#edfffa');this.regions.push({key,x,y,w,h,action,disabled});
  }
  paint() {
    if(!this.opened||!this.drawing)return;this.regions=[];const d=this.drawing;d.fillStyle='#0b2b37';d.fillRect(0,0,W,H);d.fillStyle='#0a303c';d.fillRect(0,0,W,140);
    this.text(({home:'Menú del recorrido',controls:'Controles RV',guide:'Guía del escenario',navigation:'Navegación RV'})[this.page]||'Menú RV',42,65,38);
    this.text('Apunta y pulsa · con manos: toca o haz pinza',42,112,25,'#a8d9d4');
    this.button('exit','Salir de RV',680,24,228,65,()=>this.exit(),this.exiting);this.button('close','×',925,24,65,65,()=>this.close());
    if(this.page!=='home')this.button('back','← Menú',42,160,225,65,()=>{this.page='home';});
    const ctx=this.ctx,driving=ctx.demo&&ctx.demo.driving;
    if(this.page==='home') {
      const nearby=driving&&(driving.id||driving.nearest());
      const rows=[['guide','Guía del escenario',()=>{this.page='guide';}],['controls','Controles y manos',()=>{this.page='controls';}],
        ['navigation','Navegación RV',()=>{this.page='navigation';}],['voice','Voz y consultas',()=>{this.close();if(ctx.voicePanel)ctx.voicePanel.open();}],
        ['drive',driving&&driving.id?'Bajar del vehículo':'Subir y arrancar',()=>{this.close();if(this.options.onBoard()===false){this.open();this.error='Detén el vehículo y acércate a la cabina.';}},!nearby],['pause',ctx.demo&&ctx.demo.paused?'Continuar simulación':'Pausar simulación',()=>{this.options.onPause();}],
        ['restart','Reiniciar escenario',()=>{this.close();this.options.onRestart();}],['recenter','Recentrar este menú',()=>this.place()]];
      rows.forEach(([key,label,action,disabled],i)=>this.button(key,label,42+(i%2)*480,180+Math.floor(i/2)*138,458,98,action,disabled));
      this.wrap('Menú: X/A al caminar · Y izquierdo en cabina. Con manos, usa Menú RV junto a la muñeca o frente a ti.',780,27);
    }else if(this.page==='navigation') {
      this.button('movement',ctx.studioLocomotion==='teleport'?'Movimiento: solo teletransporte':'Movimiento: caminar y teletransporte',42,270,940,98,()=>{ctx.studioLocomotion=ctx.studioLocomotion==='teleport'?'smooth':'teleport';});
      this.button('hand','Mano preferida: '+(ctx.handedness==='left'?'izquierda':'derecha'),42,400,940,98,()=>{ctx.handedness=ctx.handedness==='left'?'right':'left';ctx.raycontrol.changeHandedness(ctx.handedness);if(ctx.desktopControllerData&&ctx.desktopControllerData.inputSource)ctx.desktopControllerData.inputSource.handedness=ctx.handedness;});
      this.wrap('Apunta al suelo autorizado, mantén el gatillo o la pinza y suelta para teletransportarte. La marca roja indica un destino bloqueado.',560);
      this.wrap('El stick izquierdo camina; el derecho gira por pasos de 30°. Suelta los botones y centra los sticks después de cerrar el menú.',740,28);
    }else {
      const lines=this.page==='guide'?[
        'Explora una instalación con bandas conectadas, robot, almacén y montacargas. Acércate a las estaciones para leer sus mensajes.',
        'Recoge un pallet cuando esté detenido y completo. Alinea ambas horquillas; mantén baja la carga al conducir.',
        'Acércate y pulsa Subir y arrancar. Centra el stick izquierdo y muévelo para conducir; el gatillo izquierdo frena. A toma o coloca un pallet cercano con asistencia.',
        'Usa Voz y consultas para preguntar. Micrófono y voz dependen del soporte y los permisos del navegador del visor.'
      ]:[
        'Caminar: stick izquierdo. Girar: stick derecho hacia un lado y volver al centro.',
        'Seleccionar: apunta con el rayo y pulsa gatillo; con manos haz pinza. Toca los pulsadores con el índice y retíralo para rearmar.',
        'Teletransporte: apunta al suelo, mantén gatillo o pinza y suelta sobre un destino libre. Se desactiva al conducir.',
        'Montacargas: grip o pinza cerca del volante o palanca; mover la mano acciona el control. Suelta para dejarlo en neutro.',
        'En cabina: X freno P, A tomar/depositar, B bajar, Y izquierdo menú. Los sticks ofrecen conducción e hidráulica alternativas.'
      ];let y=280;for(const line of lines)y=this.wrap(line,y,28);
    }
    if(this.error)this.text(this.error,42,932,24,'#ffc5b9');this.texture.needsUpdate=true;
  }
  async exit() {
    const ctx=this.ctx,session=ctx.renderer.xr.getSession();if(this.exiting)return;
    if(!session||!session.end){this.error='No se encontró una sesión RV activa.';return;}
    this.exiting=true;ctx.xrExitPending=true;this.paint();
    try{await session.end();}catch(_){this.error='No se pudo salir. Vuelve a pulsar Salir de RV.';}
    finally{this.exiting=false;ctx.xrExitPending=false;if(this.opened)this.paint();}
  }
  tick() {
    const ctx=this.ctx,session=ctx.renderer.xr.getSession(),vehicle=ctx.drivingVehicle||null;
    if(this.disposed)return;
    if(!ctx.vrMode||!session||session.visibilityState&&session.visibilityState!=='visible'){if(this.opened)this.close();this.buttons=new WeakMap();this.launcher.update();if(!ctx.vrMode||!session)this.releaseResources();return;}
    if(this.session!==session||this.vehicle!==vehicle){this.session=session;this.vehicle=vehicle;this.buttons=new WeakMap();}
    let toggle=false;
    for(const data of ctx.raycontrol.controllers||[]){const source=data.inputSource,pad=source&&source.gamepad;if(data.desktop||!pad||pad.mapping!=='xr-standard'||!['left','right'].includes(source.handedness))continue;
      if(data.enabled===false||data.controller.visible===false){this.buttons.delete(source);continue;}const index=vehicle?5:4;if(vehicle&&source.handedness!=='left'||!pad.buttons[index])continue;
      const pressed=!!(pad.buttons[index].pressed||pad.buttons[index].value>.6),prior=this.buttons.get(source);this.buttons.set(source,{pressed,index});if(prior&&prior.index===index&&!prior.pressed&&pressed)toggle=true;
    }
    if(toggle)this.opened?this.close():this.open();this.launcher.update();
    if(this.opened){const key=[ctx.demo&&ctx.demo.paused,vehicle,!!(ctx.demo&&ctx.demo.driving.nearest())].join('|');if(key!==this.lastState){this.lastState=key;this.paint();}}
  }
  releaseResources() {
    this.launcher.releaseResources();const ray=this.ctx.raycontrol;
    if(this.state&&ray.states[this.name]===this.state){ray.deactivateState(this.name);delete ray.states[this.name];}
    if(this.mesh){this.mesh.parent.remove(this.mesh);this.mesh.geometry.dispose();this.mesh.material.dispose();this.texture.dispose();this.mesh=null;}this.state=null;this.canvas=this.drawing=this.texture=null;
  }
  dispose() {if(this.disposed)return;this.close();this.disposed=true;this.launcher.dispose();this.releaseResources();this.ctx.raycontrol.removeEventListener('controllerDisconnected',this.disconnected);}
}
