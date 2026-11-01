import * as THREE from 'three';

const STATES=new WeakMap();
const ACTIONS=['powerOn','powerOff','pause','speedDown','emergency','resetEmergency','dispatch','speedUp','start','stop'];
const POSITIONS={
 industrial:[[-.115,.115],[-.115,.045],[-.115,-.025],[-.115,-.095],[.115,.115],[.115,.040],[.115,-.025],[.115,-.095],[-.045,-.128],[.045,-.128]],
 training:[[-.145,.075],[-.145,.010],[-.145,-.055],[-.090,-.090],[.145,.075],[.145,.005],[.145,-.060],[.090,-.090],[-.030,-.090],[.030,-.090]]
};
function placeAt(root,group,index){root.add(group);const at=root.children.indexOf(group);root.children.splice(at,1);root.children.splice(Math.min(index,root.children.length),0,group);}

// A real small command terminal attached to the same native machine. Its
// controls use ordinary persisted control actors and the runtime's interlocks.
// It is docked, not represented as an unsupported floating handheld object.
export function attachRobotTeachPendant(root,panel,config,helpers){
 if(!root||!panel)return null;
 const style=config.pendantDesign==='training'?'training':'industrial',mount=config.pendantMount==='pedestal'?'pedestal':'cabinet',key=style+':'+mount;
 let state=STATES.get(root);const retainedControls=new Map();
 if(state&&state.key!==key){for(const control of state.controls){state.group.remove(control);retainedControls.set(control.userData.industrialAction,control);}root.remove(state.group);helpers.disposeDetached([state.group],root);STATES.delete(root);state=null;}
 if(!state){
  const group=new THREE.Group();group.name='Terminal portátil de programación · acoplado';group.userData.equipmentComponentId='robot.teach-pendant';group.userData.industrialPanelAccessory=true;group.userData.robotTeachPendant=true;
  const make=helpers.builder(),details=new THREE.Group();details.name='Carcasa, empuñaduras y soporte';
  const width=style==='industrial'?.285:.35,height=style==='industrial'?.335:.25,paint=style==='industrial'?'#303b43':'#e28b24';
  details.add(make.box('Carcasa del terminal',width,height,.050,paint,[0,0,0],{roughness:.58,metalness:.06}));
  details.add(make.box('Junta perimetral de caucho',width+.012,height+.012,.035,'#141e23',[0,0,-.003],{roughness:.92,metalness:0}));
  details.add(make.box('Frente del terminal',width-.008,height-.008,.009,paint,[0,0,.029],{roughness:.52,metalness:.06}));
  const sw=style==='industrial'?.175:.175,sh=style==='industrial'?.160:.105,sy=style==='industrial'?.025:.022;
  details.add(make.box('Bisel protector de pantalla',sw+.014,sh+.014,.009,'#101c23',[-.004,sy,.035],{roughness:.68,metalness:0}));
  for(const side of [-1,1]){
   details.add(make.box('Empuñadura posterior',.022,height*.66,.025,'#17242c',[side*(width/2-.030),0,-.033],{roughness:.88,metalness:0}));
   for(const y of [-height*.41,height*.41]){const screw=make.cylinder('Tornillo cautivo del terminal',.0035,.004,'#aab7c0',[side*(width/2-.013),y,.037],6,{metalness:.82,roughness:.35});screw.rotation.x=Math.PI/2;details.add(screw);}
  }
  // A bracket visibly supports the terminal from the cabinet or a floor post.
  if(mount==='cabinet'){
   details.add(make.box('Cuna de sujeción',width*.72,.035,.060,'#283942',[0,-height/2-.012,-.012]));
   const span=.25-width/2+.025;details.add(make.box('Brazo de soporte lateral',span,.030,.035,'#56656d',[(-.25-width/2+.025)/2,-height/2-.012,-.020],{metalness:.65,roughness:.48}));
  }else{
   const bottom=-1.14;details.add(make.box('Cuna del pedestal',width*.72,.035,.080,'#283942',[0,-height/2-.012,-.018]));
   details.add(make.box('Columna del terminal',.035,Math.abs(bottom+height/2),.035,'#687780',[0,(bottom-height/2)/2,-.035],{metalness:.6,roughness:.48}));
   details.add(make.box('Base de pedestal',.26,.024,.24,'#2b3a42',[0,bottom,-.035]));
  }
  helpers.batchDetails(details);group.add(details);
  const screen=make.box('Pantalla táctil del terminal',sw,sh,.007,'#10232d',[-.004,sy,.042],{roughness:.3,metalness:.04,emissive:'#0d2735',emissiveIntensity:.2});
  screen.userData.industrialDisplay=true;screen.userData.industrialRobotDisplay=true;screen.userData.industrialDisplayAspect=sw/sh;screen.userData.equipmentComponentId='robot.teach-pendant';group.add(screen);
  const controls=[];
  ACTIONS.forEach((action,index)=>{
   const button=retainedControls.get(action)||helpers.control(action),rest=button.userData.robotPendantRestPose,nextPosition=new THREE.Vector3(POSITIONS[style][index][0],POSITIONS[style][index][1],.040),nextScale=new THREE.Vector3().setScalar(style==='industrial'?.25:.245);
   if(!rest||button.position.distanceTo(new THREE.Vector3().fromArray(rest.position))<1e-5)button.position.copy(nextPosition);
   if(!rest||button.scale.distanceTo(new THREE.Vector3().fromArray(rest.scale))<1e-5)button.scale.copy(nextScale);
   button.userData.robotPendantRestPose={position:nextPosition.toArray(),scale:nextScale.toArray()};
   if(action==='emergency')for(const behavior of button.userData.editorDefaultBehaviors||[]){if(behavior.type==='control'){behavior.mode='command';behavior.command='emergency';behavior.value=1;}}
   button.userData.equipmentComponentId='robot.teach-pendant';group.add(button);controls.push(button);
  });
  const loom=new THREE.Group();loom.name='Cable de datos y alimentación del terminal';loom.userData.equipmentComponentId='robot.teach-pendant';
  const material=new THREE.MeshStandardMaterial({color:0x172126,roughness:.9,metalness:0});material.color.convertSRGBToLinear();material.userData={studioColorSpace:'linear',industrialMaterialRole:'rubber'};
  const cable=new THREE.Mesh(new THREE.BufferGeometry(),material);cable.name='Mazo flexible de terminal a armario';loom.add(cable);
  const gland=make.cylinder('Racor de conexión del terminal',.008,.022,'#aab7c0',[0,0,0],8,{metalness:.8,roughness:.4});loom.add(gland);group.add(loom);
  state={key,group,screen,controls,cable,gland,style,mount,updates:0};STATES.set(root,state);placeAt(root,group,2);
 }
 const {group,cable}=state;state.enabled=config.withPanel!==false&&config.pendantDesign!=='none';
 // Keep the terminal in a stable third root slot; body and existing panel paths
 // stay unchanged, and optional decorative floor cabling follows afterwards.
 if(root.children.indexOf(group)!==2)placeAt(root,group,2);
 const panelWidth=helpers.panelWidth||1.15;
 state.sync=()=>{
 group.visible=state.enabled&&panel.visible&&!!panel.parent;panel.updateMatrix();
 const wanted=new THREE.Vector3(panelWidth/2+.25+(mount==='pedestal'?.12:0),-.12,.12).applyMatrix4(panel.matrix);
 if(!state.lastPosition||group.position.distanceTo(state.lastPosition)<1e-5)group.position.copy(wanted);
 if(!state.lastQuaternion||group.quaternion.angleTo(state.lastQuaternion)<1e-5)group.quaternion.copy(panel.quaternion);
 if(!state.lastScale||group.scale.distanceTo(state.lastScale)<1e-5)group.scale.copy(panel.scale);
 state.lastPosition=wanted;state.lastQuaternion=panel.quaternion.clone();state.lastScale=panel.scale.clone();
 group.updateMatrix();root.updateMatrixWorld(true);group.updateWorldMatrix(true,false);panel.updateWorldMatrix(true,false);
 const socket=new THREE.Vector3(panelWidth/2+.009,-.45,-.12).applyMatrix4(panel.matrixWorld);const inverse=new THREE.Matrix4().getInverse(group.matrixWorld);socket.applyMatrix4(inverse);
 const normal=new THREE.Vector3(1,0,0).transformDirection(panel.matrixWorld).transformDirection(inverse);state.gland.position.copy(socket);state.gland.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);
 const width=style==='industrial'?.285:.35,height=style==='industrial'?.335:.25,from=new THREE.Vector3(width*.28,-height/2,-.024);
 const points=[from.clone(),from.clone().add(new THREE.Vector3(0,-.08,-.02)),new THREE.Vector3((from.x+socket.x)/2,Math.min(from.y,socket.y)-.16,(from.z+socket.z)/2-.07),socket.clone().addScaledVector(normal,.06),socket];
 const signature=points.map(p=>p.toArray().map(n=>Math.round(n*1e5))).join('|');
 if(signature!==state.cableSignature){const geometry=new THREE.TubeBufferGeometry(new THREE.CatmullRomCurve3(points,false,'centripetal'),28,.0045,6,false);cable.geometry.dispose();cable.geometry=geometry;state.cableSignature=signature;state.updates++;}
 state.socket=socket;return state;
 };
 Object.defineProperty(root.userData,'robotTeachPendantSync',{value:state.sync,configurable:true,enumerable:false});state.sync();return state;
}

export function robotTeachPendantState(root){return STATES.get(root)||null;}
