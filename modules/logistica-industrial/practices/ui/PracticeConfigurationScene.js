import * as THREE from 'three';
import {studyWorkspace} from '../../scenarios/StudySceneProject.js';
import {buildConfigurablePracticeScene} from '../configurable/runtime/ConfigurablePracticeScene.js';
import SurfaceMaterialSystem from '../../../../packages/tools/editor/src/SurfaceMaterialSystem.js';

/** An isolated authoring workspace, never a simulation or a live project. */
export function disposePreviewGeometry(root){
 const geometries=new Set(),materials=new Set(),textures=new Set();
 root.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const material of(Array.isArray(node.material)?node.material:[node.material]).filter(Boolean)){materials.add(material);for(const key of Object.keys(material))if(material[key]&&material[key].isTexture)textures.add(material[key]);}});
 textures.forEach(value=>{if(!(value.userData&&value.userData.sharedIndustrialTexture))value.dispose();});materials.forEach(value=>value.dispose());geometries.forEach(value=>value.dispose());
}
/** Fit the installation being configured, not its distant navigation fence or
 * the terrain/road-marking batches that continue beyond the warehouse. */
export function configurationFitBounds(model){
 const fit=new THREE.Box3(),facility=model.manifest.facility||{},layout=facility.sharedLayout,bounds=layout&&layout.bounds;
 const rect=(value,low,high)=>{if(!Array.isArray(value)||value.length!==4||!value.every(Number.isFinite))return;fit.expandByPoint(new THREE.Vector3(value[0],low,value[1]));fit.expandByPoint(new THREE.Vector3(value[2],high,value[3]));};
 if(bounds&&[bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ,bounds.height].every(Number.isFinite)){
  rect([bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ],(bounds.floorY||0)-.25,bounds.height);
  for(const annex of Object.values(layout.annexes||{})){const low=Number.isFinite(annex.floorY)?annex.floorY:0,high=low+(Number.isFinite(annex.height)?annex.height:bounds.height);rect(annex.rect,low,high);rect(annex.connectorRect,low,high);if(annex.ramp)rect(annex.ramp.rect,Math.min(annex.ramp.fromY||0,annex.ramp.toY||0),Math.max(annex.ramp.fromY||0,annex.ramp.toY||0));}
  // These are the actual mounted bodies and loads, including a truck/leveler
  // outside the front wall. Their native transforms remain entirely unchanged.
  const ids=new Set((model.manifest.aliases||[]).map(row=>row.objectId).concat(model.manifest.productIds||[]));for(const id of ids){const object=model.document.getObject(id);if(object&&object.visible)fit.expandByObject(object);}
 }else{
  for(const object of model.document.getObjects('hall')){const data=object.userData.practiceFacility||{};if(!object.visible||/terrain|outdoor-ground|outdoor-envelope/.test(data.role||''))continue;fit.expandByObject(object);}
 }
 if(fit.isEmpty())fit.setFromObject(model.root);return fit.expandByScalar(.4);
}
export function previewCutawayObject(object){
 const metadata=object.userData&&object.userData.practiceFacility;if(!metadata)return false;if(['roof','ceiling'].includes(metadata.role))return true;
 // A merged bank containing even one low part is left intact. This rule can
 // remove a dedicated upper fixture, never columns, mixed trims or machinery.
 object.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(object);return!bounds.isEmpty()&&Number.isFinite(bounds.min.y)&&bounds.min.y>=8.8;
}
export async function buildConfigurationScene(practiceId,settings,{isCurrent=()=>true,onInvalidate=()=>{}}={}){
 const workspace=studyWorkspace();let surfaces=null,disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;if(surfaces)surfaces.dispose();disposePreviewGeometry(workspace.scene);};
 try{
  const built=buildConfigurablePracticeScene(workspace.document,'hall',practiceId,Object.assign({},settings,{scene:workspace.scene,preview:true}));
  if(!isCurrent()){dispose();return null;}
  surfaces=new SurfaceMaterialSystem({scene:workspace.scene},workspace.document,null,onInvalidate);await surfaces.sync('hall');
  if(!isCurrent()){dispose();return null;}
   const root=workspace.roots.hall,roofs=[],labels=[];root.updateWorldMatrix(true,true);
  for(const object of workspace.document.getObjects('hall')){if(previewCutawayObject(object))roofs.push(object);if(/Cámara principal|Inicio del nivel/.test(object.name||''))object.visible=false;}
  for(const row of built.manifest.aliases||[]){const object=workspace.document.getObject(row.objectId);if(object){const bounds=new THREE.Box3().setFromObject(object);labels.push({id:row.alias||row.sourceElementId,name:row.sourceName||row.name||object.name,position:bounds.getCenter(new THREE.Vector3())});const marker=new THREE.Box3Helper(bounds,0xe1ad32);marker.material.depthTest=false;marker.material.transparent=true;marker.material.opacity=.65;marker.userData.editorHelper=true;workspace.scene.add(marker);}}
  return{...workspace,root,manifest:built.manifest,plan:built.plan,roofs,labels,dispose};
 }catch(error){dispose();throw error;}
}

/** One renderer, on-demand frames and bounded pixels for both native views. */
export default class PracticeConfigurationScene{
 constructor(host,{record,onStatus=()=>{},onStats=()=>{}}={}){
  this.host=host;this.record=record;this.onStatus=onStatus;this.onStats=onStats;this.disposed=false;this.generation=0;this.view='2d';this.roof=false;this.azimuth=.75;this.elevation=.9;this.zoom=1;this.listeners=[];
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});this.renderer.setPixelRatio(1);this.renderer.setClearColor('#eaf3f3');this.renderer.outputEncoding=THREE.sRGBEncoding;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1;
  this.renderer.domElement.setAttribute('aria-label','Vista nativa de la instalación y del equipamiento seleccionado');this.renderer.domElement.setAttribute('data-practice-native-preview','');host.appendChild(this.renderer.domElement);
  this.camera=new THREE.OrthographicCamera(-50,50,40,-40,.1,2000);this.center=new THREE.Vector3();this.size=new THREE.Vector3(64,10,60);
  this.listen(this.renderer.domElement,'webglcontextlost',event=>{event.preventDefault();this.contextLost=true;this.onStatus('El navegador interrumpió la vista 3D. Cierra y vuelve a abrir la configuración para recuperarla.','error');});
  this.listen(this.renderer.domElement,'pointerdown',event=>{if(this.view!=='3d'||event.button!==0)return;this.pointer={id:event.pointerId,x:event.clientX,y:event.clientY};if(event.currentTarget.setPointerCapture)event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();});
  this.listen(this.renderer.domElement,'pointermove',event=>{if(!this.pointer||this.pointer.id!==event.pointerId)return;this.azimuth-=(event.clientX-this.pointer.x)*.007;this.elevation=Math.max(.18,Math.min(1.48,this.elevation+(event.clientY-this.pointer.y)*.005));this.pointer.x=event.clientX;this.pointer.y=event.clientY;this.requestRender();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])this.listen(this.renderer.domElement,type,()=>{this.pointer=null;});
  this.listen(this.renderer.domElement,'wheel',event=>{if(this.view!=='3d')return;event.preventDefault();this.zoom=Math.max(.55,Math.min(3,this.zoom*(event.deltaY>0?.92:1.08)));this.requestRender();},{passive:false});
  if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(()=>this.requestRender());this.observer.observe(host);}else this.listen(window,'resize',()=>this.requestRender());
 }
 listen(target,event,callback,options){target.addEventListener(event,callback,options);this.listeners.push(()=>target.removeEventListener(event,callback,options));}
 async update(settings){
  const generation=++this.generation;this.onStatus('Preparando instalación y activos nativos…','busy');let next;
  try{next=await buildConfigurationScene(this.record.id,settings,{isCurrent:()=>!this.disposed&&generation===this.generation,onInvalidate:()=>this.requestRender()});if(!next)return;if(this.disposed||generation!==this.generation){next.dispose();return;}const previous=this.model;this.model=next;if(previous)previous.dispose();
   const scene=next.scene;scene.background=new THREE.Color('#eaf3f3');scene.add(new THREE.HemisphereLight('#eaf9ff','#647477',.65));const sun=new THREE.DirectionalLight('#fff5e9',.7);sun.position.set(25,65,30);scene.add(sun);const fill=new THREE.DirectionalLight('#dcecff',.25);fill.position.set(-35,28,-15);scene.add(fill);
   // Ignore the exterior terrain skirt when fitting: the facility and its
   // annexes remain complete, while far parking terrain never wastes the frame.
   const fit=configurationFitBounds(next);fit.getCenter(this.center);fit.getSize(this.size);this.bounds=fit;this.zoom=1;
   this.setRoof(this.roof);this.onStatus('Configuración nativa · sin iniciar la simulación.','ready');this.requestRender();
  }catch(error){if(next)next.dispose();if(!this.disposed&&generation===this.generation)this.onStatus(error.message||'No se pudo preparar la vista nativa.','error');}
 }
 setView(value){this.view=value==='3d'?'3d':'2d';this.pointer=null;this.requestRender();}
 setRoof(value){this.roof=!!value;if(this.model)this.model.roofs.forEach(object=>{object.visible=this.roof&&this.view==='3d';});this.requestRender();}
 fit(){this.zoom=1;this.azimuth=.75;this.elevation=.9;this.requestRender();}
 zoomBy(value){this.zoom=Math.max(.55,Math.min(3,this.zoom*value));this.requestRender();}
 requestRender(){if(this.disposed||this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.render();});}
 render(){
  if(this.disposed||this.contextLost||!this.model)return;const box=this.host.getBoundingClientRect();if(box.width<2||box.height<2)return;
  const dpr=Math.min(1.4,window.devicePixelRatio||1),ratio=Math.min(dpr,1400/box.width,1000/box.height),width=Math.max(2,Math.round(box.width*ratio)),height=Math.max(2,Math.round(box.height*ratio));this.renderer.setSize(width,height,false);const aspect=width/height;
  if(this.view==='2d'){this.camera.up.set(0,0,-1);this.camera.position.copy(this.center).add(new THREE.Vector3(0,300,0));this.model.roofs.forEach(object=>{object.visible=false;});}
  else{this.camera.up.set(0,1,0);this.camera.position.copy(this.center).add(new THREE.Vector3(Math.sin(this.azimuth)*Math.cos(this.elevation),Math.sin(this.elevation),Math.cos(this.azimuth)*Math.cos(this.elevation)).multiplyScalar(300));this.model.roofs.forEach(object=>{object.visible=this.roof;});}
  this.camera.lookAt(this.center);this.camera.updateMatrixWorld(true);let halfX=0,halfY=0;const corner=new THREE.Vector3(),bounds=this.bounds;for(let n=0;n<8;n++){corner.set(n&1?bounds.max.x:bounds.min.x,n&2?bounds.max.y:bounds.min.y,n&4?bounds.max.z:bounds.min.z).applyMatrix4(this.camera.matrixWorldInverse);halfX=Math.max(halfX,Math.abs(corner.x));halfY=Math.max(halfY,Math.abs(corner.y));}halfY=Math.max(halfY,halfX/aspect,1)*1.08/this.zoom;halfX=halfY*aspect;this.camera.left=-halfX;this.camera.right=halfX;this.camera.top=halfY;this.camera.bottom=-halfY;this.camera.near=.1;this.camera.far=2000;this.camera.updateProjectionMatrix();this.renderer.render(this.model.scene,this.camera);
  const labels=this.model.labels.map(row=>{const point=row.position.clone().project(this.camera);return{id:row.id,name:row.name,x:(point.x+1)*50,y:(1-point.y)*50,visible:point.z>=-1&&point.z<=1&&Math.abs(point.x)<1&&Math.abs(point.y)<1};});
  this.onStats({view:this.view,width,height,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,labels,layoutId:this.model.manifest.facility&&this.model.manifest.facility.layoutId,parts:this.model.manifest.aliases.length,mode:this.model.plan.mode,products:this.model.manifest.productIds.length,facility:this.model.manifest.facility,operatingData:this.model.manifest.operatingData,context:this.model.manifest.cediContext});
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.generation++;if(this.frame)cancelAnimationFrame(this.frame);if(this.observer)this.observer.disconnect();this.listeners.splice(0).forEach(remove=>remove());if(this.model)this.model.dispose();this.model=null;this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
}
