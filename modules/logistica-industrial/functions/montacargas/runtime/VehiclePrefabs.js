import * as THREE from 'three';
import vehicles from '../schema/vehicles.js';
import {createVehicleDetailBuilder} from './VehicleDetailGeometry.js';

const RIGS=new WeakMap(), UP=new THREE.Vector3(0,1,0);
function aging(amount,seed) { const data=new Uint8Array(64*64*4);let random=seed;for(let i=0;i<data.length;i+=4){random=(Math.imul(random,1664525)+1013904223)>>>0;const n=random/4294967296,p=i/4,x=p%64,y=Math.floor(p/64);let value=.97+n*.03;value-=amount*.16*Math.max(0,Math.sin(x*.11+Math.cos(y*.14))-.2);value-=amount*.12*Math.max(0,Math.sin(y*.065+x*.018));if(n>1-amount*.008)value*=.76;data[i]=data[i+1]=data[i+2]=Math.floor(value*255);data[i+3]=255;}const map=new THREE.DataTexture(data,64,64,THREE.RGBAFormat);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.generateMipmaps=true;map.minFilter=THREE.LinearMipmapLinearFilter;map.needsUpdate=true;return map; }
function builder(c) {
  const cache=new Map(), maps=[],wearMap=aging(c.wear,1327); maps.push(wearMap); const mat=(name,color,metalness,roughness)=>{const material=new THREE.MeshStandardMaterial({color,metalness,roughness,map:wearMap});material.name=name;return material;};
  const forkColor=c.forkColor.toLowerCase()==='#677682'?'#9eacb5':c.forkColor;
  const materials={frame:mat('Carrocería',c.frameColor,c.finish==='polymer'?.05:.5,c.finish==='steel'?.35:.57),accent:mat('Protecciones',c.accentColor,.2,.7),steel:mat('Mecanizado','#677682',.85,.36),forkSteel:mat('Horquillas · acero satinado',forkColor,.55,.38),rubber:mat('Neumáticos','#252b2b',.02,.9),seat:mat('Asiento','#303639',0,.85),glass:new THREE.MeshStandardMaterial({color:'#a9c8d3',metalness:.05,roughness:.16,transparent:true,opacity:.23}),light:new THREE.MeshStandardMaterial({color:'#e8ead3',emissive:'#e8ead3',emissiveIntensity:.1}),red:new THREE.MeshStandardMaterial({color:'#9a3335',emissive:'#c43428',emissiveIntensity:.05})};
  Object.entries(materials).forEach(([role,material])=>{material.color.convertSRGBToLinear();if(material.emissive)material.emissive.convertSRGBToLinear();material.userData.studioColorSpace='linear';material.userData.industrialMaterialRole=role;});
  const geometry=(key,create)=>{if(!cache.has(key))cache.set(key,create());return cache.get(key);};
  const mesh=(name,geo,role,parent,position)=>{const object=new THREE.Mesh(geo,materials[role]);object.name=name;object.castShadow=role!=='glass';object.receiveShadow=true;Object.assign(object.userData,{materialPart:role,materialPartLabel:{frame:'Carrocería',accent:'Protecciones',steel:'Mástil y mecanismos',forkSteel:'Horquillas de acero satinado',rubber:'Rodadura',seat:'Puesto de operador',glass:'Cristales',light:'Luces',red:'Pilotos'}[role],industrialMaterialPart:role,industrialMaterialRole:role,industrialPart:name});if(role==='forkSteel')object.userData.vehicleForkTine=true;if(position)object.position.fromArray(position);parent.add(object);return object;};
  const box=(name,size,role,parent,position)=>mesh(name,geometry('b'+size.join(','),()=>new THREE.BoxBufferGeometry(...size)),role,parent,position);
  const cylinder=(name,radius,length,role,parent,position,segments=12)=>mesh(name,geometry('c'+[radius,length,segments],()=>new THREE.CylinderBufferGeometry(radius,radius,length,segments)),role,parent,position);
  const rod=(name,a,z,radius,role,parent)=>{const start=new THREE.Vector3().fromArray(a),end=new THREE.Vector3().fromArray(z),object=cylinder(name,radius,start.distanceTo(end),role,parent,start.clone().add(end).multiplyScalar(.5).toArray(),8);object.quaternion.setFromUnitVectors(UP,end.sub(start).normalize());return object;};
  const rounded=(name,size,role,parent,position)=>{const [w,h,d]=size,r=Math.min(.07,w*.12,h*.16),shape=new THREE.Shape();shape.moveTo(-w/2+r,-h/2);shape.lineTo(w/2-r,-h/2);shape.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);shape.lineTo(w/2,h/2-r);shape.quadraticCurveTo(w/2,h/2,w/2-r,h/2);shape.lineTo(-w/2+r,h/2);shape.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);shape.lineTo(-w/2,-h/2+r);shape.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);const geo=geometry('r'+size.join(','),()=>{const g=new THREE.ExtrudeBufferGeometry(shape,{depth:d,bevelEnabled:false,curveSegments:c.detail==='low'?2:4,steps:1});g.translate(0,0,-d/2);return g;});return mesh(name,geo,role,parent,position);};
  return {materials,cache,maps,box,cylinder,rod,rounded,mesh,geometry};
}
function group(parent,name,position=[0,0,0]) {const object=new THREE.Group();object.name=name;object.position.fromArray(position);parent.add(object);return object;}
function cab(b,rig,c,parent,standing=false) {
  const d=rig.detail,cabin=group(parent,'Puesto de conducción',[0,0,-c.length*.08]);rig.cabin=cabin;rig.cabinBase=0;
  const x=c.width*.38,z=Math.min(.67,c.length*.28),top=Math.max(1.72,c.height),floor=.42;
  rig.cabDimensions={x,z,top,floor};rig.continuity=[];
  const structural=object=>{object.userData.vehiclePreserve=true;return object;},join=(a,b)=>{rig.continuity.push([a,b]);};
  rig.driverSeat=group(cabin,'Vista del operador',[0,standing?1.65:1.58,-.18]);rig.controls={wheel:null,levers:[]};
  const cabFloor=structural(d.solid('Piso y umbral de cabina',[x*2,.07,z*2],'accent',cabin,[0,floor,0]));rig.cabFloor=cabFloor;
  for(let i=-3;i<=3;i++)b.box('Canal antideslizante',[x*1.75,.006,.012],'rubber',cabin,[0,floor+.041,i*.11]);
  // A real footwell separates the rear power module from the operator's seat.
  if(c.cabInterior!==false&&!standing){
    const pedestal=structural(d.shapeExtrusion('Pedestal plegado de asiento',[[-.18,-.09],[.18,-.09],[.145,.09],[-.145,.09]],.34,'accent',cabin,[0,.535,-.25],.012));rig.seatPedestal=pedestal;join(cabFloor,pedestal);
    const suspension=structural(d.solid('Suspensión y fuelle del asiento',[.36,.105,.34],'rubber',cabin,[0,.672,-.25],.014));join(pedestal,suspension);
    for(let rib=0;rib<3;rib++)d.solid('Pliegue del fuelle de suspensión',[.37,.012,.35],'accent',cabin,[0,.64+rib*.028,-.25],.003);
    const cushion=d.solid('Cojín ergonómico de asiento',[.46,.13,.45],'seat',cabin,[0,.81,-.25],.035);cushion.userData.vehiclePreserve=true;rig.seatCushion=cushion;
    rig.seatRails=[];for(const side of [-1,1]){const rail=structural(d.solid('Corredera de asiento',[.042,.035,.39],'steel',cabin,[side*.125,.735,-.25],.004));rig.seatRails.push(rail);join(suspension,rail);join(rail,cushion);b.rod('Anclaje de apoyabrazos',[side*.125,.735,-.35],[side*.28,.755,-.35],.018,'steel',cabin);}
    const back=d.solid('Respaldo contorneado',[.45,.48,.115],'seat',cabin,[0,1.10,-.47],.035);back.rotation.x=-.10;back.userData.vehiclePreserve=true;rig.seatBack=back;
    for(const side of [-1,1]){const support=structural(d.hose('Soporte curvo de respaldo',[[side*.145,.72,-.39],[side*.145,.78,-.46],[side*.145,1.02,-.49]],.018,cabin,'steel'));join(support,back);}
    d.solid('Apoyo lumbar',[.35,.16,.055],'seat',cabin,[0,.99,-.394],.025);
    for(const side of [-1,1]){d.solid('Refuerzo lateral de asiento',[.065,.10,.38],'seat',cabin,[side*.215,.87,-.25]);b.rod('Soporte de apoyabrazos',[side*.28,.75,-.35],[side*.28,1.02,-.35],.018,'steel',cabin);d.solid('Apoyabrazos acolchado',[.085,.065,.29],'seat',cabin,[side*.28,1.03,-.28]);}
    const belt=b.box('Cinturón de retención',[.40,.025,.045],'accent',cabin,[0,.89,-.22]);belt.rotation.y=.12;d.solid('Hebilla de cinturón',[.055,.03,.065],'red',cabin,[.05,.903,-.21],.004);
    for(let i=-2;i<=2;i++)b.box('Costura del asiento',[.003,.003,.33],'accent',cabin,[i*.055,.868,-.25]);
    rig.pedals={};for(const side of [-1,1]){const accelerator=side<0,pedal=d.solid(accelerator?'Pedal de acelerador':'Pedal de freno',[.10,.028,.18],'rubber',cabin,[side*.14,.49,.25],.008);pedal.rotation.x=.22;rig.pedals[accelerator?'accelerator':'brake']=pedal;for(let row=-2;row<=2;row++)b.box('Estría de pedal',[.088,.005,.009],'steel',pedal,[0,.017,row*.027]);}
  }else if(standing){d.solid('Apoyo lumbar de pie',[.27,.48,.10],'seat',cabin,[-c.width*.27,.97,-.36]);d.shapeExtrusion('Pedestal de apoyo del operador',[[-.07,-.20],[.07,-.20],[.09,.20],[-.09,.20]],.09,'accent',cabin,[-c.width*.27,.65,-.36],.007);}
  // Open protective frame; the former opaque roof no longer hides its bars.
  rig.cabPosts=[];
  for(const side of [-1,1])for(const end of [-1,1]){const post=structural(d.solid('Pilar de guardatecho',[.055,top-floor,.06],'accent',cabin,[side*x,(top+floor)/2,end*z],.008));post.rotation.x=end*.025;rig.cabPosts.push({side,end,object:post});join(cabFloor,post);}
  for(const side of [-1,1])b.box('Larguero de guardatecho',[.07,.07,z*2+.13],'accent',cabin,[side*x,top,0]);
  for(const end of [-1,1])b.box('Travesaño de guardatecho',[x*2+.1,.07,.075],'accent',cabin,[0,top,end*z]);
  for(let i=-3;i<=3;i++)b.box('Barra superior de protección',[.033,.045,z*2],'steel',cabin,[i*x*.23,top+.008,0]);
  if(c.cabinStyle==='protected'||c.cabinStyle==='enclosed')b.box('Cubierta transparente superior',[x*2,.008,z*2],'glass',cabin,[0,top+.04,0]);
  if(c.cabinStyle==='enclosed'){
    for(const end of [-1,1]){const glass=b.box(end>0?'Parabrisas frontal':'Cristal posterior',[x*2-.10,top-.80,.012],'glass',cabin,[0,(top+.75)/2,end*z]);glass.userData.vehiclePreserve=true;if(end>0)rig.frontGlass=glass;}
    for(const side of [-1,1]){b.box('Cristal lateral',[.012,top-.91,z*2-.12],'glass',cabin,[side*x,(top+.87)/2,0]);d.solid('Puerta inferior',[.025,.31,z*2-.10],'frame',cabin,[side*x,.67,0]);b.rod('Tirador de puerta',[side*(x+.018),.98,-.20],[side*(x+.018),.98,.02],.014,'accent',cabin);}
    d.hose('Limpiaparabrisas',[[0,.88,z+.025],[.22,1.15,z+.026],[.25,1.50,z+.026]],.008,cabin);
  }
  for(const side of [-1,1]){d.solid('Escalón de acceso',[.19,.055,.42],'steel',cabin,[side*(x+.08),.28,-.08]);for(let n=-2;n<=2;n++)b.box('Relieve antideslizante',[.14,.009,.015],'rubber',cabin,[side*(x+.08),.312,-.08+n*.07]);d.hose('Manija de acceso',[[side*x,.72,-z-.02],[side*x,1.16,-z-.02],[side*x,1.23,-z+.05]],.019,cabin);}
  const dashSupport=structural(d.shapeExtrusion('Pedestal inclinado de salpicadero',[[-.105,-.24],[.105,-.24],[.17,.24],[-.17,.24]],.19,'accent',cabin,[0,.69,.40],.012));rig.dashSupport=dashSupport;join(cabFloor,dashSupport);
  const console=d.solid('Consola de instrumentos',[Math.min(.54,c.width*.5),.20,.22],'accent',cabin,[0,1.03,.37]);console.rotation.x=-.15;structural(console);rig.dashboard=console;join(dashSupport,console);
  const screen=b.box('Display de estado',[.21,.10,.009],'light',console,[0,.015,-.116]);screen.userData.vehiclePreserve=true;
  for(const side of [-1,1]){const gauge=b.cylinder('Aro de indicador',.038,.012,'steel',console,[side*.17,.025,-.12],14);gauge.rotation.x=Math.PI/2;const dot=b.cylinder('Piloto del tablero',.011,.009,side<0?'red':'light',console,[side*.17,-.055,-.13],8);dot.rotation.x=Math.PI/2;}
  const wheelAngle=-(Math.PI/2+.58),wheelCenter=[0,1.12,.18],normal=new THREE.Vector3(0,-Math.sin(wheelAngle),Math.cos(wheelAngle));
  const columnBottom=new THREE.Vector3().fromArray(wheelCenter).addScaledVector(normal,-(1.12-.455)/normal.y);
  const column=structural(b.rod('Columna de dirección conectada',columnBottom.toArray(),wheelCenter,.035,'accent',cabin));rig.steeringColumn=column;join(cabFloor,column);
  const wheel=group(cabin,'Volante · pivote',wheelCenter);wheel.rotation.x=wheelAngle;
  const ring=d.torus('Aro real de volante',.17,.017,'rubber',wheel,[0,0,0]);ring.userData.vehiclePreserve=true;
  const hub=b.cylinder('Centro de volante',.049,.055,'accent',wheel,[0,0,0],16);hub.rotation.x=Math.PI/2;
  structural(hub);rig.steeringHub=hub;join(column,hub);
  for(let index=0;index<3;index++){const angle=Math.PI/2+index*Math.PI*2/3;const spoke=b.rod('Radio de volante',[0,0,0],[Math.cos(angle)*.153,Math.sin(angle)*.153,0],.009,'steel',wheel);spoke.userData.vehiclePreserve=true;}
  // The rim normal faces the operator: positive local-Z rotation is visibly
  // counter-clockwise/left. Logical steering is positive to the driver's right.
  const grip=group(wheel,'Agarre del aro',[0,.17,0]);rig.controls.wheel={id:'steering',object:wheel,pivot:wheel,grip,axis:[0,0,1],inputSign:-1,pivotLocal:[0,0,0],radius:.17,maxAngle:1.25,restQuaternion:wheel.quaternion.clone()};rig.controls.steering=rig.controls.wheel;rig.steeringWheel=wheel;
  const features=vehicles.supports(c),leverIds=['lift','tilt','reach','sideShift','turret'].filter(id=>features[id]);
  const leverDepth=Math.max(.30,leverIds.length*.09+.04),leverSupport=structural(d.shapeExtrusion('Pedestal de consola hidráulica',[[-.065,-.175],[.065,-.175],[.077,.175],[-.077,.175]],leverDepth*.88,'accent',cabin,[x*.82,.625,-.02],.009));rig.leverSupport=leverSupport;join(cabFloor,leverSupport);
  const leverConsole=structural(d.solid('Módulo de mandos hidráulicos',[.16,.16,leverDepth],'accent',cabin,[x*.82,.88,-.02]));rig.leverConsole=leverConsole;join(leverSupport,leverConsole);
  leverIds.forEach((id,index)=>{
    const pivot=group(cabin,'Palanca '+id,[x*.82,.97,-.16+index*.09]);const stem=b.rod('Vástago de palanca',[0,0,0],[0,.19,0],.009,'steel',pivot);
    const knob=d.solid('Pomo de '+id,[.044,.062,.052],'rubber',pivot,[0,.215,0],.013);stem.userData.vehiclePreserve=knob.userData.vehiclePreserve=true;
    const boot=d.torus('Fuelle de mando',.026,.008,'rubber',pivot,[0,.012,0]);boot.rotation.x=Math.PI/2;
    const grip=group(pivot,'Agarre '+id,[0,.215,0]);rig.controls.levers.push({id,object:pivot,pivot,grip,axis:[0,0,1],rotationAxis:[1,0,0],pivotLocal:[0,0,0],travel:Math.sin(.35)*.215,maxAngle:.35,restQuaternion:pivot.quaternion.clone()});
  });
  d.decal(cabin,1,[.15,.075],[x*.82-.095,.88,-.02],[0,-Math.PI/2,0],leverConsole);
  if(rig.seatBack)d.decal(rig.seatBack,3,[.16,.08],[0,.055,-.0705],[0,Math.PI,0],rig.seatBack);
  d.bolts(cabin,[-1,1].flatMap(side=>[-1,1].map(end=>[side*(x+.035),floor+.10,end*z])),.014);
}
function wheels(b,rig,c,parent) {
  const d=rig.detail,warehouse=['reach','stacker','pallet-truck'].includes(c.family),rearOnly=c.variant==='forklift-electric-3w'||warehouse;
  for(const end of [-1,1])for(const side of [-1,1]){
    if(rearOnly&&end<0&&side>0)continue;
    if(warehouse&&end>0)continue;
    const x=rearOnly&&end<0?0:side*c.track/2,z=end*c.wheelbase/2;
    const pivot=group(parent,'Dirección '+(end<0?'trasera':'delantera'),[x,c.wheelRadius,z]);
    const roll=group(pivot,'Giro de rueda'),radius=c.wheelRadius,treadWidth=c.width*.15;
    const profile=[[-treadWidth/2,radius*.77],[-treadWidth*.46,radius*.94],[-treadWidth*.32,radius],[treadWidth*.32,radius],[treadWidth*.46,radius*.94],[treadWidth/2,radius*.77],[treadWidth/2,radius*.57],[-treadWidth/2,radius*.57],[-treadWidth/2,radius*.77]].map(([y,r])=>new THREE.Vector2(r,y));
    const tyre=b.mesh('Neumático de hombro redondeado',b.geometry('tire:'+radius+':'+treadWidth+':'+d.segments,()=>new THREE.LatheBufferGeometry(profile,d.segments)),'rubber',roll,[0,0,0]);tyre.rotation.z=Math.PI/2;
    const hub=b.cylinder('Llanta embutida',radius*.58,treadWidth*.89,'steel',roll,[0,0,0],d.segments);hub.rotation.z=Math.PI/2;
    for(const face of [-1,1]){
      const cap=b.cylinder('Cubo de eje',radius*.29,.025,'accent',roll,[face*(treadWidth/2+.008),0,0],d.segments);cap.rotation.z=Math.PI/2;
      const rim=d.torus('Pestaña de llanta',radius*.61,.014,'steel',roll,[face*treadWidth*.48,0,0]);rim.rotation.y=Math.PI/2;
      d.bolts(roll,Array.from({length:d.level?6:4},(_,i)=>{const a=i*Math.PI*2/(d.level?6:4);return[face*(treadWidth/2+.023),Math.cos(a)*radius*.40,Math.sin(a)*radius*.40];}),Math.min(.014,radius*.045));
      if(d.level>0)for(let ring=0;ring<2;ring++){const sidewall=d.torus('Nervio de flanco',radius*(.72+ring*.13),.004,'rubber',roll,[face*(treadWidth*.48),0,0]);sidewall.rotation.y=Math.PI/2;}
    }
    rig.wheels.push({pivot,roll,steering:end<0||c.family==='cart'&&end>0});
    const rugged=c.family==='rough-terrain'||c.family==='telehandler',count=d.level===0?12:d.level===1?20:28;
    for(let i=0;i<count;i++){const a=i*Math.PI*2/count;const tread=b.box(rugged?'Taco de tracción':'Banda de rodadura',[treadWidth*(rugged?1.05:.82),rugged?.038:.009,radius*(rugged?.28:.06)],'rubber',roll,[0,Math.cos(a)*(radius+.001),Math.sin(a)*(radius+.001)]);tread.rotation.x=-a;tread.rotation.y=rugged?(i%2?.18:-.18):0;}
    if(!warehouse){
      const count=8+d.level*4,outer=radius+.085,inner=radius+.045,profile=[];
      for(let index=0;index<=count;index++){const angle=index*Math.PI/count;profile.push([Math.cos(angle)*outer,Math.sin(angle)*outer]);}
      for(let index=count;index>=0;index--){const angle=index*Math.PI/count;profile.push([Math.cos(angle)*inner,Math.sin(angle)*inner]);}
      const guard=d.shapeExtrusion('Guardabarros de chapa curvada',profile,treadWidth+.065,'frame',parent,[x,c.wheelRadius,z],0);guard.rotation.y=Math.PI/2;guard.userData.vehiclePreserve=true;
      if(!rig.fenders)rig.fenders=[];rig.fenders.push(guard);
      for(const end of [-1,1])b.rod('Soporte de guardabarros',[x*.85,Math.max(.18,c.wheelRadius-.04),z+end*radius*.65],[x,c.wheelRadius+radius*.48,z+end*radius*.73],.018,'accent',parent);
    }
  }
}
function forkAssembly(b,rig,c,parent) {
  const forks=group(parent,'Cara superior / talón de horquillas');rig.forks=forks;
  const lowLift=c.family==='pallet-truck';
  b.box('Portahorquillas',[Math.max(.75,c.forkSpread+c.forkWidth+.15),lowLift?.07:.12,.09],'steel',forks,[0,lowLift?.04:.30,-.06]);
  for(const side of [-1,1]){
    const blade=b.box('Uña horizontal',[c.forkWidth,c.forkThickness,c.forkLength-.12],'forkSteel',forks,[side*c.forkSpread/2,-c.forkThickness/2,(c.forkLength-.12)/2]);blade.userData.vehicleForkBlade=true;
    const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(.12,-c.forkThickness*.6);shape.lineTo(.12,-c.forkThickness);shape.lineTo(0,-c.forkThickness);shape.closePath();
    const tip=new THREE.ExtrudeBufferGeometry(shape,{depth:c.forkWidth,bevelEnabled:false,steps:1});tip.rotateY(-Math.PI/2);tip.translate(c.forkWidth/2,0,c.forkLength-.12);
    const object=b.mesh('Punta biselada de horquilla',tip,'forkSteel',forks,[side*c.forkSpread/2,0,0]);object.userData.vehicleForkBlade=true;
    if(!lowLift)b.box('Talón vertical',[c.forkWidth,.48,c.forkThickness],'forkSteel',forks,[side*c.forkSpread/2,.24,-c.forkThickness/2]);
  }
  if(lowLift)return;
  for(const side of [-1,1])b.rod('Marco de respaldo',[side*c.width*.31,.2,-.1],[side*c.width*.31,.9,-.1],.018,'steel',forks);
  b.rod('Borde superior de respaldo',[-c.width*.31,.9,-.1],[c.width*.31,.9,-.1],.018,'steel',forks);
  for(let i=-2;i<=2;i++)b.box('Rejilla de respaldo',[.012,.55,.018],'steel',forks,[i*c.width*.11,.58,-.1]);
}
function mast(b,rig,c,parent) {
  const d=rig.detail;
  const reach=group(parent,'Mástil móvil / carro de alcance',[0,0,c.length/2-.10]);rig.reach=reach;
  const pivot=group(reach,'Inclinación de mástil',[0,.15,0]);rig.mast=pivot;
  const railWidth=Math.max(.56,c.width*.58),height=Math.max(.6,c.mastHeight),stage=group(pivot,'Etapa telescópica interior');rig.mastStage=stage;rig.mastStages=[];
  for(const side of [-1,1]){
    b.box('Alma de perfil exterior C',[.025,height,.12],'steel',pivot,[side*(railWidth/2+.03),height/2,0]);
    for(const face of [-1,1])b.box('Ala de perfil C',[.09,height,.022],'steel',pivot,[side*railWidth/2,height/2,face*.052]);
    b.box('Guía de rodamiento',[.025,height*.84,.02],'accent',pivot,[side*(railWidth/2+.04),height*.45,.06]);
  }
  const mastTop=b.box('Travesaño superior',[railWidth+.1,.08,.12],'steel',pivot,[0,height,0]);
  const stageCount=Math.max(1,Math.ceil(c.maxLift/(height*.72)));
  for(let index=1;index<=stageCount;index++){
    const nested=group(pivot,'Guía telescópica '+index),stageZ=.045+index*.025,rails=[];
    for(const side of [-1,1])rails.push(b.box('Perfil de etapa '+index,[.045,height*.9,.055],'steel',nested,[side*(railWidth/2-.10-index*.018),height*.45,stageZ]));
    const bridge=b.box('Puente de etapa',[railWidth*.8,.045,.05],'steel',nested,[0,height*.87,stageZ]);
    rig.mastStages.push({object:nested,fraction:index/stageCount,rails,bridge,stageZ});
  }
  const cylinder=b.cylinder('Camisa de cilindro hidráulico',.045,height*.54,'accent',pivot,[0,height*.29,.02],12);
  const piston=b.cylinder('Vástago cromado continuo',.021,1,'steel',pivot,[0,height*.65,.03],12);piston.userData.vehiclePreserve=true;rig.hydraulicPiston=piston;
  const hydraulicStage=rig.mastStages[0].object;rig.liftHydraulic={start:new THREE.Vector3(0,height*.54,.03),stage:hydraulicStage,endY:height*.87,piston};
  const clevis=b.cylinder('Pasador de vástago',.024,.12,'steel',hydraulicStage,[0,height*.87,.03],12);clevis.rotation.z=Math.PI/2;clevis.userData.vehiclePreserve=true;rig.hydraulicClevis=clevis;
  for(const y of [height*.08,height*.54]){const collar=b.cylinder('Collar del cilindro',.057,.032,'steel',pivot,[0,y,.02],d.segments);}
  d.bolts(pivot,[-1,1].flatMap(side=>[.15,height-.12].map(y=>[side*(railWidth/2+.047),y,.01])),.014);
  const carriage=group(pivot,'Portahorquillas elevable',[0,c.forkBaseHeight-.15,.10]);rig.carriage=carriage;
  const carriagePlate=d.solid('Placa de unión de carro y mástil',[railWidth*.95,.33,.065],'steel',carriage,[0,.30,-.075],.007);carriagePlate.userData.vehiclePreserve=true;rig.carriagePlate=carriagePlate;
  for(const side of [-1,1])for(const y of [.20,.43]){const roller=b.cylinder('Rodillo guía de carro',.045,.035,'accent',carriage,[side*railWidth*.40,y,-.11],12);roller.rotation.z=Math.PI/2;}
  const shift=group(carriage,'Desplazador lateral');rig.sideShift=shift;
  const turret=group(shift,'Cabezal trilateral');rig.turret=turret;
  if(c.family==='turret') {const drum=b.cylinder('Rodamiento de giro trilateral',.24,.14,'steel',turret,[0,.15,-.1],16);drum.rotation.x=Math.PI/2;}
  forkAssembly(b,rig,c,turret);
  // Batched link plates/pins and a curved return hose reveal the mechanism
  // without an imported chain assembly or hundreds of separate draw calls.
  const chainStage=rig.mastStages[rig.mastStages.length-1],chainFrame=chainStage.object,pulleyY=height*.87,pulleyZ=chainStage.stageZ-.11,pulleyRadius=Math.min(.073,height*.11),anchorY=c.forkBaseHeight+.15;
  // The sheaves belong to the moving inner crosshead. Their old centres were
  // above the last bridge with no axle or bearing support. A single transverse
  // axle now runs through two journal bearings, with folded clevis plates tied
  // into the same stage's bridge; the whole assembly shares its lift/tilt frame.
  const preserve=object=>{object.userData.vehiclePreserve=true;return object;};
  preserve(chainStage.bridge);chainStage.rails.forEach(preserve);
  const axle=preserve(b.cylinder('Eje transversal de poleas',.014,.44,'steel',chainFrame,[0,pulleyY,pulleyZ],12));axle.rotation.z=Math.PI/2;
  const lowerBridge=preserve(b.box('Puente inferior de anclaje de cadena',[railWidth*.8,.06,.06],'steel',chainFrame,[0,anchorY,chainStage.stageZ]));
  rig.mastPulleyMounts=[];rig.mastChains=[];
  for(const side of [-1,1]){
    const bracket=preserve(b.box('Oreja de apoyo de polea',[.035,.12,.16],'steel',chainFrame,[side*.213,pulleyY,chainStage.stageZ-.055]));
    const bearing=preserve(b.cylinder('Cojinete de eje de polea',.030,.036,'steel',chainFrame,[side*.198,pulleyY,pulleyZ],12));bearing.rotation.z=Math.PI/2;
    const pulley=preserve(b.cylinder('Polea de cadena',pulleyRadius,.042,'accent',chainFrame,[side*.16,pulleyY,pulleyZ],d.segments));pulley.rotation.z=Math.PI/2;
    const center=new THREE.Vector3(side*.16,pulleyY,pulleyZ);rig.mastPulleyMounts.push({frame:chainFrame,bridge:chainStage.bridge,rails:chainStage.rails,bracket,bearing,axle,pulley,center});
    const backZ=pulleyZ-pulleyRadius,frontZ=pulleyZ+pulleyRadius,plateZ=.025,carriageAnchor=preserve(b.box('Anclaje de cadena al portahorquillas',[.065,.075,Math.abs(plateZ-backZ)+.04],'steel',carriage,[side*.16,.30,(plateZ+backZ)/2-.10]));
    const returnAnchor=preserve(b.box('Anclaje de retorno de cadena',[.065,.075,Math.abs(frontZ-chainStage.stageZ)+.024],'steel',chainFrame,[side*.16,anchorY,(frontZ+chainStage.stageZ)/2]));
    const count=12+d.level*10,pitch=Math.max(.001,(pulleyY-anchorY)/count),geometry=b.geometry('chain-plate',()=>new THREE.BoxBufferGeometry(.025,pitch*.90,.009));
    const chain=new THREE.InstancedMesh(geometry,b.materials.steel,count*4),matrix=new THREE.Matrix4();
    for(let run=0;run<2;run++)for(let index=0;index<count*2;index++){matrix.makeTranslation(side*.16+(index%2?-.009:.009),anchorY+(Math.floor(index/2)+.5)*pitch,run?frontZ:backZ);chain.setMatrixAt(run*count*2+index,matrix);}chain.name='Placas de cadena de elevación';chain.castShadow=chain.receiveShadow=true;chainFrame.add(chain);
    const loop=preserve(d.torus('Retorno de cadena sobre polea',pulleyRadius+.003,.006,'steel',chainFrame,[side*.16,pulleyY,pulleyZ],Math.PI));loop.rotation.y=Math.PI/2;
    rig.mastChains.push({frame:chainFrame,object:chain,loop,carriageAnchor,returnAnchor,lowerBridge,carriagePlate,pulley,anchorY,backZ,frontZ,count,pitch});
    d.hose('Circuito curvo unido al cilindro',[[side*(railWidth*.57),.16,-.045],[side*(railWidth*.60),height*.45,-.045],[side*(railWidth*.45),height*.57,.02],[side*.05,height*.47,.02]],.011,pivot);
    b.rod('Racor hidráulico',[side*(railWidth*.57),.10,-.045],[side*(railWidth*.57),.22,-.045],.018,'steel',pivot);
    b.rod('Racor de cilindro',[side*.02,height*.47,.02],[side*.07,height*.47,.02],.019,'steel',pivot);
  }
  d.decal(pivot,2,[.12,.06],[0,height-.012,.0615],undefined,mastTop);
}
function telehandler(b,rig,c,parent) {
  const d=rig.detail;
  const pivot=group(parent,'Pivote de brazo telescópico',[0,c.boomPivotHeight,-c.length*.24]);rig.boom=pivot;
  d.shapeExtrusion('Torre de apoyo del brazo',[[-.23,-.26],[.23,-.26],[.19,.26],[-.19,.26]],.24,'accent',parent,[0,c.boomPivotHeight-.22,-c.length*.24],.014);
  for(const side of [-1,1]){const bearing=b.cylinder('Cojinete de pivote de brazo',.12,.07,'steel',parent,[side*.205,c.boomPivotHeight,-c.length*.24],16);bearing.rotation.z=Math.PI/2;}
  b.rounded('Camisa exterior del brazo',[.35,.36,c.boomLength],'frame',pivot,[0,0,c.boomLength/2]);
  b.rounded('Etapa interior de brazo',[.24,.25,c.boomLength*.8],'steel',pivot,[0,0,c.boomLength*.62]);
  const extension=group(pivot,'Extensión hidráulica',[0,0,c.boomLength]);rig.boomExtension=extension;
  b.box('Punta de brazo telescópico',[.22,.23,c.boomLength*.65],'steel',extension,[0,0,-c.boomLength*.325]);
  const level=group(extension,'Nivelación de implemento');rig.level=level;const shift=group(level,'Desplazador lateral',[0,c.forkBaseHeight-c.boomPivotHeight,0]);rig.sideShift=shift;forkAssembly(b,rig,c,shift);
  d.solid('Placa continua de acople rápido',[.37,.80,.08],'steel',level,[0,-.35,-.075],.008);
  const barrel=b.cylinder('Camisa de elevación de brazo',.060,1,'accent',parent),rod=b.cylinder('Vástago de elevación de brazo',.027,1,'steel',parent),upper=group(pivot,'Anclaje móvil del cilindro',[0,-.16,c.boomLength*.55]);
  barrel.userData.vehiclePreserve=rod.userData.vehiclePreserve=true;
  const lower=new THREE.Vector3(0,Math.max(.48,c.wheelRadius+.08),-c.length*.05);rig.boomHydraulic={barrel,rod,upper,lower};
  const lowerPin=b.cylinder('Pasador inferior hidráulico',.055,.20,'steel',parent,lower.toArray(),12);lowerPin.rotation.z=Math.PI/2;const upperPin=b.cylinder('Pasador superior hidráulico',.055,.20,'steel',upper,[0,0,0],12);upperPin.rotation.z=Math.PI/2;
  b.rod('Circuito hidráulico de brazo',[.18,0,.2],[.18,0,c.boomLength*.8],.012,'rubber',pivot);
}
function build(root,c) {
  const b=builder(c),visual=group(root,'Vehículo · conjunto mecánico');visual.userData.vehicleVisual=true;
  const rig={config:c,visual,wheels:[],lights:[],forks:null,driverSeat:null,pose:null,resources:b};
  rig.detail=createVehicleDetailBuilder(b,c);const d=rig.detail;
  const f=vehicles.supports(c),bodyTop=vehicles.getDimensions(c).bodyTop;
  d.solid('Bastidor inferior biselado',[c.width,.20,c.length],'accent',visual,[0,Math.max(.18,c.wheelRadius-.04),0]);
  if(c.family==='cart') {
    b.box('Plataforma de carga',[c.width,.09,c.length],'frame',visual,[0,c.height,0]);
    for(const end of [-1,1]){const skirt=d.solid('Faldón plegado de plataforma',[c.width*.96,.16,.024],'accent',visual,[0,c.height-.06,end*c.length*.49],.006);if(end<0)d.decal(visual,3,[.18,.075],[0,c.height-.06,-c.length*.49-.016],[0,Math.PI,0],skirt);}
    for(const side of [-1,1]){b.rod('Montante de empuje',[side*c.width*.4,c.height,-c.length*.45],[side*c.width*.4,c.height+.55,-c.length*.45],.025,'steel',visual);}
    b.rod('Asa de empuje',[-c.width*.4,c.height+.55,-c.length*.45],[c.width*.4,c.height+.55,-c.length*.45],.025,'steel',visual);
    rig.forks=group(visual,'Superficie de plataforma',[0,c.height+.045,0]);rig.driverSeat=group(visual,'Vista del operador',[0,1.65,-c.length/2-.5]);
  } else if(c.family==='pallet-truck') {
    const pumpBody=b.rounded('Bomba y módulo de tracción',[c.width*.7,.37,c.length*.8],'frame',visual,[0,.27,-.05]);
    for(const side of [-1,1])d.decal(visual,0,[Math.min(.17,c.length*.35),.075],[side*(c.width*.35+.002),.29,-.05],[0,side*Math.PI/2,0],pumpBody);
    const tiller=group(visual,'Timón de conducción',[0,.35,-c.length/2]);rig.tiller=tiller;
    rig.tillerGripPosition=[0,.70,-.33];
    b.rod('Barra del timón',[0,0,0],[0,.70,-.33],.025,'accent',tiller);b.box('Empuñadura y mandos',[.36,.06,.11],'accent',tiller,[0,.7,-.33]);
    const carriage=group(visual,'Bomba de elevación',[0,c.forkBaseHeight,c.length/2]);rig.palletLift=carriage;forkAssembly(b,rig,c,carriage);
    rig.loadRollers=[];
    for(const side of [-1,1]) {
      // Ground-contact load rollers sit at the toe, beyond the Euro pallet's
      // rear bottom board. The former .78*length placed them through that board.
      const radius=.045,restDy=c.forkBaseHeight-c.forkThickness+.012-radius,linkLength=Math.max(.28,Math.abs(restDy+c.maxLift)+.035),restDz=Math.sqrt(linkLength*linkLength-restDy*restDy),pivotZ=c.forkLength-radius-restDz;
      const wheel=b.cylinder('Rodillo de carga',radius,c.forkWidth*.7,'rubber',visual,[side*c.forkSpread/2,radius,c.length/2+c.forkLength-radius],12);wheel.rotation.z=Math.PI/2;wheel.userData.vehiclePreserve=true;
      const axle=b.cylinder('Eje de rodillo de carga',.009,c.forkWidth*.98,'steel',visual,wheel.position.toArray(),10);axle.rotation.z=Math.PI/2;axle.userData.vehiclePreserve=true;
      const pin=b.cylinder('Pasador de biela de carga',.009,c.forkWidth*.98,'steel',rig.forks,[side*c.forkSpread/2,-c.forkThickness+.012,pivotZ],10);pin.rotation.z=Math.PI/2;pin.userData.vehiclePreserve=true;
      const links=[-1,1].map(edge=>{const rod=b.cylinder('Biela articulada de rodillo',.006,1,'steel',rig.forks,[side*c.forkSpread/2+edge*c.forkWidth*.42,0,0],8);rod.userData.vehiclePreserve=true;return {object:rod,x:side*c.forkSpread/2+edge*c.forkWidth*.42};});
      rig.loadRollers.push({wheel,axle,pin,links,side,radius,linkLength,pivotZ});
    }
    rig.driverSeat=group(visual,'Vista del operador',[0,1.65,-c.length/2-.55]);
    if(c.variant==='pallet-truck-electric')b.box('Plataforma abatible de operador',[c.width*.7,.06,.4],'accent',visual,[0,.14,-c.length/2-.24]);
  } else if(c.family==='stacker') {
    const stackerBody=b.rounded('Cabezal de apilador acompañante',[Math.min(.75,c.width*.8),.65,c.length*.7],'frame',visual,[0,.42,-c.length*.19]);
    for(const side of [-1,1])d.decal(visual,0,[.20,.09],[side*(Math.min(.75,c.width*.8)/2+.002),.43,-c.length*.19],[0,side*Math.PI/2,0],stackerBody);
    const tiller=group(visual,'Timón de apilador',[0,.55,-c.length/2]);rig.tiller=tiller;
    rig.tillerGripPosition=[0,.55,-.35];
    b.rod('Brazo de mando',[0,0,0],[0,.55,-.35],.025,'accent',tiller);b.box('Empuñadura de mando',[.34,.08,.12],'accent',tiller,[0,.55,-.35]);
    rig.driverSeat=group(visual,'Vista del operador acompañante',[0,1.65,-c.length/2-.55]);mast(b,rig,c,visual);
    for(const side of [-1,1])b.box('Brazo estabilizador',[.13,.13,c.length*.85],'accent',visual,[side*(c.width/2-.08),.13,c.length*.62]);
  } else {
    // Rear counterweight terminates behind the seat. The central volume is a
    // low power/battery deck, leaving real legroom and a clear seat silhouette.
    const hoodRear=-c.length*.495,hoodFront=Math.min(-c.length*.27,-c.length*.08-.54),hoodDepth=hoodFront-hoodRear,hoodHeight=Math.min(.70,c.height*.30),hoodZ=(hoodRear+hoodFront)/2;
    const hoodBevel=Math.min(.04,c.filletRadius||.025),hood=d.shapeExtrusion('Contrapeso de perfil esculpido',[[-c.width*.44,-hoodHeight*.5],[c.width*.44,-hoodHeight*.5],[c.width*.47,-hoodHeight*.17],[c.width*.47,hoodHeight*.25],[c.width*.32,hoodHeight*.5],[-c.width*.32,hoodHeight*.5],[-c.width*.47,hoodHeight*.25],[-c.width*.47,-hoodHeight*.17]],hoodDepth,'frame',visual,[0,.61,hoodZ],hoodBevel);hood.userData.vehiclePreserve=true;rig.counterweight=hood;
    d.solid('Cubierta baja de batería y transmisión',[c.width*.80,.18,c.length*.47],'frame',visual,[0,.32,-c.length*.03]);
    const access=d.solid('Tapa de servicio posterior',[c.width*.61,.035,hoodDepth*.63],'accent',visual,[0,.61+hoodHeight*.52,hoodZ],.012);access.rotation.x=.03;
    d.hose('Asa de capó',[[-.12,.64+hoodHeight*.53,hoodZ],[0,.69+hoodHeight*.53,hoodZ],[.12,.64+hoodHeight*.53,hoodZ]],.012,visual,'steel');
    for(const side of [-1,1]){
      const labelHost=d.solid('Portaetiquetas de acceso lateral',[.016,.24,hoodDepth*.76],'frame',visual,[side*(c.width*.47+hoodBevel+.005),.63,hoodZ],.002);
      const labelWidth=Math.min(.29,hoodDepth*.68);d.decal(visual,0,[labelWidth,.105],[side*(c.width*.47+hoodBevel+.015),.68,hoodZ],[0,side*Math.PI/2,0],labelHost);d.decal(visual,5,[Math.min(.17,labelWidth),.065],[side*(c.width*.47+hoodBevel+.015),.565,hoodZ],[0,side*Math.PI/2,0],labelHost);
    }
    const rearZ=hoodRear-hoodBevel;rig.rearBodyZ=rearZ;
    const rearPanel=d.solid('Panel posterior de servicio',[c.width*.52,.46,.018],'accent',visual,[0,.64,rearZ-.004],.003);
    for(let i=0;i<6+d.level*2;i++)b.box('Rejilla de ventilación posterior',[c.width*.43,.011,.012],'steel',visual,[0,.50+i*.018,rearZ-.019]);
    d.decal(visual,2,[.21,.085],[0,.75,rearZ-.015],[0,Math.PI,0],rearPanel);d.decal(visual,0,[.23,.055],[0,.84,rearZ-.015],[0,Math.PI,0],rearPanel);d.decal(visual,5,[.19,.055],[0,.455,rearZ-.015],[0,Math.PI,0],rearPanel);
    if(c.family==='telehandler') {cab(b,rig,Object.assign({},c,{width:c.width*.62,height:c.height}),visual);rig.cabin.position.x=-c.width*.25;telehandler(b,rig,c,visual);}
    else {cab(b,rig,c,visual,['reach','order-picker','turret','stacker'].includes(c.family));if(f.forks)mast(b,rig,c,visual);}
    if(c.family==='reach'||c.family==='stacker')for(const side of [-1,1])b.box('Brazo de apoyo inferior',[.13,.13,c.length*.8],'accent',visual,[side*(c.width/2-.08),.13,c.length*.6]);
    if(c.variant==='forklift-ic') {const tank=b.cylinder('Depósito posterior de combustible',.17,c.width*.65,'steel',visual,[0,1.06,-c.length*.44],d.segments);tank.rotation.z=Math.PI/2;for(const side of [-1,1]){const strap=d.torus('Abrazadera de depósito',.174,.013,'accent',visual,[side*c.width*.20,1.06,-c.length*.44]);strap.rotation.y=Math.PI/2;}d.hose('Línea de combustible',[[c.width*.3,1.06,-c.length*.44],[c.width*.40,.94,-c.length*.42],[c.width*.35,.56,-c.length*.30]],.012,visual);b.rod('Escape protegido',[c.width*.35,.6,-c.length*.3],[c.width*.35,c.height*.9,-c.length*.3],.035,'accent',visual);}
  }
  wheels(b,rig,c,visual);
  if(c.family==='reach'||c.family==='stacker')for(const side of [-1,1]){const pivot=group(visual,'Rodillo de apoyo delantero',[side*(c.width/2-.08),.065,c.length*.94]),roll=group(pivot,'Giro de rodillo de apoyo');const wheel=b.cylinder('Rodillo de brazo estabilizador',.065,.08,'rubber',roll,[0,0,0],10);wheel.rotation.z=Math.PI/2;rig.wheels.push({pivot,roll,steering:false});}
  if(rig.cabin){
    const dims=rig.cabDimensions;rig.cabLampMounts=[];
    for(const side of [-1,1]){
      const post=rig.cabPosts.find(value=>value.side===side&&value.end===1).object,y=Math.min(dims.top-.15,1.6)-(dims.top+dims.floor)/2;
      // Work lamps are mounted directly to the inclined front pillars. A dark
      // backing plate and case make the attachment legible from the driver's
      // view; only the small lens is emissive, rather than a floating pale cube.
      const mount=d.solid('Placa de fijación de faro',[.080,.085,.035],'steel',post,[0,y,.032],.003);mount.userData.vehiclePreserve=true;
      const housing=d.solid('Carcasa protectora de faro',[.13,.105,.080],'accent',post,[0,y,.073],.009);housing.userData.vehiclePreserve=true;
      const lamp=d.solid('Lente de faro de trabajo',[.103,.073,.014],'light',post,[0,y,.119],.004);lamp.userData.vehiclePreserve=true;
      rig.lights.push(lamp);rig.cabLampMounts.push({post,mount,housing,lens:lamp});
      b.box('Piloto trasero',[.11,.07,.025],'red',visual,[side*c.width*.29,.56,(rig.rearBodyZ||-c.length*.49)-.015]);
    }
    b.cylinder('Base de baliza',.058,.065,'accent',rig.cabin,[dims.x*.55,dims.top+.056,-dims.z*.6],12);const beacon=b.cylinder('Baliza de aviso',.052,.085,'light',rig.cabin,[dims.x*.55,dims.top+.12,-dims.z*.6],12);rig.lights.push(beacon);
  }else if(c.family==='stacker'&&rig.mast){for(const side of [-1,1]){const lamp=b.box('Faro anclado al travesaño',[.10,.075,.06],'light',rig.mast,[side*c.width*.17,c.mastHeight+.015,.065]);rig.lights.push(lamp);}}
  rig.hitch=group(visual,'Enganche posterior',[0,.3,-c.length/2-.18]);rig.trailerHitch=group(visual,'Lanza delantera',[0,.3,c.length/2+.35]);
  if(f.hitch){b.rod('Lanza y ojo de enganche',[0,.3,c.length/2-.05],[0,.3,c.length/2+.35],.025,'steel',visual);b.box('Bloque de enganche',[.12,.12,.10],'steel',rig.hitch,[0,0,0]);}
  const boltGeo=new THREE.CylinderBufferGeometry(.016,.016,.018,6),bolts=new THREE.InstancedMesh(boltGeo,b.materials.steel,16),matrix=new THREE.Matrix4();
  for(let i=0;i<16;i++){const side=i<8?-1:1,n=i%8;matrix.compose(new THREE.Vector3(side*c.width*.46,.48+(n%2)*.18,-c.length*.35+Math.floor(n/2)*c.length*.2),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2),new THREE.Vector3(1,1,1));bolts.setMatrixAt(i,matrix);}bolts.name='Tornillería de chasis';bolts.castShadow=true;visual.add(bolts);
  if(!rig.controls)rig.controls={wheel:null,levers:[]};
  if(rig.tiller){const head=rig.tillerGripPosition||[0,.70,-.33],grip=group(rig.tiller,'Agarre de timón',head);rig.controls.wheel={id:'steering',object:rig.tiller,pivot:rig.tiller,grip,gripOnly:true,axis:[0,1,0],inputSign:1,pivotLocal:[0,0,0],radius:.22,maxAngle:c.steerLimit,restQuaternion:rig.tiller.quaternion.clone()};rig.controls.steering=rig.controls.wheel;const lever=group(rig.tiller,'Mando de elevación',[.11,head[1]-.01,head[2]]);d.solid('Gatillo de elevación',[.06,.03,.08],'red',lever,[0,0,0],.005);rig.controls.levers.push({id:'lift',object:lever,pivot:lever,grip:group(lever,'Agarre lift'),axis:[0,0,1],rotationAxis:[1,0,0],pivotLocal:[0,0,0],travel:.04,maxAngle:.25,restQuaternion:lever.quaternion.clone()});}
  d.batch(visual);
  Object.defineProperty(root.userData,'vehicleRig',{value:rig,configurable:true,enumerable:false});RIGS.set(root,rig);return rig;
}
function dispose(root) {const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(node=>{if(node.geometry)geometries.add(node.geometry);(Array.isArray(node.material)?node.material:[node.material]).filter(Boolean).forEach(m=>{materials.add(m);Object.values(m).forEach(v=>{if(v&&v.isTexture)textures.add(v);});});});textures.forEach(v=>v.dispose());materials.forEach(v=>v.dispose());geometries.forEach(v=>v.dispose());}
export function createVehicle(value={}) {const config=vehicles.normalize(value),root=new THREE.Group();root.name=(vehicles.getDefinition(config.variant)||{}).name||'Vehículo';root.userData.editorPrefabKey='vehicle';root.userData.editorPrefabVariant=config.variant;refreshVehicleGeometry(root,config);return root;}
export function refreshVehicleGeometry(root,value={}) {const config=vehicles.normalize(value),prior=RIGS.get(root)||root.userData.vehicleRig;if(prior&&prior.visual){root.remove(prior.visual);dispose(prior.visual);}const rig=build(root,config);updateVehiclePose(root,vehicles.initialPose(config));return root;}
export function updateVehiclePose(root,pose={}) {const rig=RIGS.get(root)||root.userData.vehicleRig;if(!rig)return null;const c=rig.config,clamp=THREE.Math.clamp,lift=clamp(pose.lift||0,0,c.maxLift),reach=clamp(pose.reach||0,0,c.maxReach),tilt=clamp(pose.tilt||0,-c.tiltLimit,c.tiltLimit);
  if(rig.reach)rig.reach.position.z=c.length/2-.10+reach;if(rig.mast)rig.mast.rotation.x=tilt;
  if(rig.carriage)rig.carriage.position.y=c.forkBaseHeight-.15+lift;if(rig.mastStage)rig.mastStage.position.y=lift*.55;
  if(rig.mastStages)rig.mastStages.forEach(stage=>{stage.object.position.y=lift*stage.fraction;});
  if(rig.liftHydraulic){const h=rig.liftHydraulic,start=h.start,end=new THREE.Vector3(0,h.endY+h.stage.position.y,.03),direction=end.clone().sub(start);h.piston.position.copy(start).add(end).multiplyScalar(.5);h.piston.scale.y=direction.length();h.piston.quaternion.setFromUnitVectors(UP,direction.normalize());}
  if(rig.sideShift)rig.sideShift.position.x=clamp(pose.sideShift||0,-c.maxSideShift,c.maxSideShift);if(rig.turret)rig.turret.rotation.y=clamp(pose.turret||0,-c.turretLimit,c.turretLimit);
  if(rig.boom){const angle=clamp(pose.boomAngle||0,-.08,c.boomAngleLimit);rig.boom.rotation.x=-angle;rig.boomExtension.position.z=c.boomLength+reach;rig.level.rotation.x=angle+tilt;}
  if(rig.boomHydraulic){const h=rig.boomHydraulic;rig.boom.updateMatrix();const upper=h.upper.position.clone().applyMatrix4(rig.boom.matrix),direction=upper.clone().sub(h.lower),length=direction.length(),axis=direction.clone().normalize(),bodyLength=Math.min(.42,length*.75),start=h.lower.clone().addScaledVector(axis,bodyLength*.85);h.barrel.position.copy(h.lower).addScaledVector(axis,bodyLength*.5);h.barrel.scale.y=bodyLength;h.barrel.quaternion.setFromUnitVectors(UP,axis);h.rod.position.copy(start).add(upper).multiplyScalar(.5);h.rod.scale.y=upper.distanceTo(start);h.rod.quaternion.copy(h.barrel.quaternion);}
  if(rig.palletLift)rig.palletLift.position.y=c.forkBaseHeight+lift;
  if(rig.loadRollers)rig.loadRollers.forEach(roller=>{const topY=c.forkBaseHeight+lift-c.forkThickness+.012,dy=topY-roller.radius,dz=Math.sqrt(Math.max(0,roller.linkLength*roller.linkLength-dy*dy)),axleZ=c.length/2+roller.pivotZ+dz;
    roller.wheel.position.z=roller.axle.position.z=axleZ;roller.wheel.rotation.x=pose.wheelRoll||0;
    roller.links.forEach(link=>{const start=new THREE.Vector3(link.x,-c.forkThickness+.012,roller.pivotZ),end=new THREE.Vector3(link.x,roller.radius-c.forkBaseHeight-lift,axleZ-c.length/2),direction=end.clone().sub(start);link.object.position.copy(start).add(end).multiplyScalar(.5);link.object.scale.y=direction.length();link.object.quaternion.setFromUnitVectors(UP,direction.normalize());});
  });
  if(vehicles.supports(c).risingCab&&rig.cabin)rig.cabin.position.y=lift;
  // Rear-steered trucks turn the rear wheels opposite to their front heading:
  // logical right gives chassis yaw<0 and rear-wheel yaw>0 in the +Z-forward rig.
  const steering=pose.steer||0,ackermann=(c.family==='counterbalance'&&c.variant!=='forklift-electric-3w'||c.family==='rough-terrain')&&Math.abs(steering)>1e-6;
  rig.wheels.forEach(wheel=>{let angle=steering;if(wheel.steering&&ackermann){const sign=Math.sign(steering),radius=c.wheelbase/Math.tan(Math.abs(steering));angle=sign*Math.atan2(c.wheelbase,Math.max(.05,radius+sign*wheel.pivot.position.x));}wheel.pivot.rotation.y=wheel.steering?angle:0;wheel.roll.rotation.x=pose.wheelRoll||0;});
  if(rig.controls){const wheel=rig.controls.wheel;if(wheel){const override=wheel.object.userData.cabControlValue,value=override===undefined?(pose.steer||0)/c.steerLimit*(wheel.inputSign===undefined?1:wheel.inputSign):override;wheel.object.quaternion.copy(wheel.restQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().fromArray(wheel.axis),clamp(value,-1,1)*wheel.maxAngle));}rig.controls.levers.forEach(control=>{control.object.quaternion.copy(control.restQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().fromArray(control.rotationAxis||[1,0,0]),clamp(control.object.userData.cabControlValue||0,-1,1)*control.maxAngle));});}
  rig.lights.forEach(light=>{light.material.emissiveIntensity=pose.lights?.8:.08;});rig.pose=Object.assign({},pose,{lift,reach,tilt});root.updateWorldMatrix(true,true);return rig.pose;
}
export function getVehicleForkTransform(root) {const rig=RIGS.get(root)||root.userData.vehicleRig;if(!rig||!rig.forks)return null;root.updateWorldMatrix(true,true);const inverse=new THREE.Matrix4().getInverse(root.matrixWorld),matrix=new THREE.Matrix4().multiplyMatrices(inverse,rig.forks.matrixWorld),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,quaternion,scale);return {position,quaternion,matrix,tool:rig.forks};}
