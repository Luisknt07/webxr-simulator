'use strict';
const traffic=require('./PublicDemoTraffic.cjs');

/** Dedicated public recipe. Retain the physical robot/pallet/forklift cell;
 * use the other half of the room for observable carton transfers. */
function buildPublicDemoScene({THREE,schema,document,roomId,scene,base,ConveyorAssembly}) {
  if(!base||!base.robot||!base.pickup||!base.vehicle)throw new Error('Falta la célula de transferencia nativa.');
  const additions=[],machineTypes=['source','robot','conveyor','palletQueue','product','vehicle'];
  const config=object=>document.getBehaviors(object).find(value=>machineTypes.includes(value.type));
  const patch=(object,changes)=>document.setBehaviors(object,document.getBehaviors(object).map(value=>machineTypes.includes(value.type)?Object.assign({},value,changes):value));
  const add=(type,name,variant,values,position)=>{const object=document.addPrefab(roomId,type,variant);patch(object,values);document.setProperty(object,'name',name);document.setTransform(object,{position});additions.push(object);return object;};
  const part=(name,color,position,scale,behaviors=[])=>{const object=document.addPrimitive(roomId,'box',color);document.setProperty(object,'name',name);document.setTransform(object,{position,scale});document.setBehaviors(object,behaviors);additions.push(object);return object;};
  const solid=()=>schema.defaultBehavior('collision');
  const finish=color=>Object.assign(schema.defaultBehavior('surfaceMaterial'),{preset:'custom',color,roughness:.88,metalness:0,colorMapMode:'none'});
  // Replace the isolated lane, the empty guide and the solid front wall.
  base.objects.slice().filter(object=>/guía de la práctica|pasillos y textos editables|pared frontal|pared posterior/.test(object.name)).forEach(object=>{document.remove(object);base.objects=base.objects.filter(value=>value!==object);});

  const source=add('source','01 · recepción y admisión de productos',undefined,{
    running:true,autoGenerate:false,initialCount:0,totalLimit:32,capacity:2,interval:3,delivery:'automatic',withPanel:false,loadMode:'individual',generationMode:'sequence',
    catalog:JSON.stringify([
      {id:'demo-carton-natural',name:'Caja de recepción',type:'box',variant:'box-small',width:.3,depth:.3,height:.22,mass:2,base:'flat',color:'#b98d53',quality:'good',defect:'none'},
      {id:'demo-carton-blue',name:'Caja de clasificación azul',type:'box',variant:'box-small',width:.28,depth:.28,height:.24,mass:2,base:'flat',color:'#4e8c9d',quality:'good',defect:'none'},
      {id:'demo-crate',name:'Caja plástica retornable',type:'crate',variant:'crate',width:.3,depth:.3,height:.22,mass:2,base:'rigid',color:'#537f59',quality:'good',defect:'none'}
    ])
  },[-6.7,1,-6.8]);
  const belts=[
    add('conveyor','DEMOSTRACIÓN · 01 banda de alimentación','belt-start',{length:2.4},[0,1,0]),
    add('conveyor','DEMOSTRACIÓN · 02 transferencia a rodillos','roller-middle',{length:1.8},[0,1,0]),
    add('conveyor','DEMOSTRACIÓN · 03 curva de transferencia','belt-curve-left',{radius:.95,curveAngle:90},[0,1,0]),
    add('conveyor','DEMOSTRACIÓN · 04 banda de descarga de cajas','belt-end',{length:1.2},[0,1,0])
  ];
  belts.forEach((belt,index)=>patch(belt,{powered:true,running:true,autoSpawn:false,withPanel:index===0,withSensors:index===0,width:.65,supportHeight:1,speed:.32,maxPackages:6,maxLoad:25,clearance:.6}));
  // Keep the native robot workbench: its deck and input port share the
  // conveyor height. A floor pallet queue would force the robot below it.
  const receiver=base.source;
  const receivingRotation=receiver.quaternion.clone();
  patch(receiver,{running:true,withPanel:false,autoGenerate:false,initialCount:0,totalLimit:8,capacity:1,delivery:'manual'});
  const assembly=new ConveyorAssembly({document,roomId,root:document.getRoot(roomId),ctx:{scene},hooks:{renderScene:scene},assemblyMessage(){}}),transferLinks=[];
  try{const chain=[source,...belts,receiver];for(let i=1;i<chain.length;i++){
    const from=chain[i-1],to=chain[i];
    if(!assembly.align(from,'output',to,'input')||!assembly.connect(assembly.pair(to,'input',from,'output')))throw new Error('No se pudo conectar la línea de cajas: '+from.name);
    transferLinks.push({source:from.userData.editorId,sourcePort:'output',target:to.userData.editorId,targetPort:'input'});
  }}finally{assembly.clear();}

  // One physical flow: arriving cartons become the robot's actual input.
  // Preserve every native port, custody transfer and articulated robot joint.
  const turn=receivingRotation.multiply(receiver.quaternion.clone().inverse()),origin=receiver.position.clone();
  for(const object of [source,...belts,receiver]){
    object.quaternion.premultiply(turn);
    document.setTransform(object,{position:object.position.clone().sub(origin).applyQuaternion(turn).add(new THREE.Vector3(-1.3,1,1.3)).toArray(),rotation:object.rotation.toArray().slice(0,3)});
  }
  patch(base.robot,{sourceId:receiver.userData.editorId,withPanel:false});base.source=source;
  transferLinks.push({source:receiver.userData.editorId,sourcePort:'output',target:base.robot.userData.editorId,targetPort:'input'});
  document.setProperty(receiver,'name','02 · mesa de recepción del robot');
  document.setProperty(base.robot,'name','02 · robot de paletizado');
  document.setProperty(base.palletizer,'name','03 · formación de pallets de cuatro cajas');
  document.setProperty(base.pickup,'name','04 · recogida de pallets con montacargas');
  document.setProperty(base.destination,'name','06 · despacho de pallets completos');
  patch(base.palletizer,{palletizeLimit:8});
  document.setTransform(base.vehicle,{position:traffic.HOME.position.slice(),rotation:[0,traffic.HOME.yaw,0]});
  patch(base.vehicle,{waypointsJson:traffic.waypoints(config(base.vehicle).sourceId,config(base.vehicle).outputId)});

  const rack=add('palletQueue','DEMOSTRACIÓN · rack doble de tres niveles A01 / R01','selective',Object.assign({},schema.warehouseRacks.defaults('selective'),{
    running:true,withPanel:false,rackBays:2,rackLevels:3,rackColumns:2,rackBayWidth:3,rackBaseHeight:.3,rackLevelHeight:1.25,rackSlotDepth:1.1,
    rackAisleCode:'A01',rackRowCode:'R01',rackAssignments:'[]',acceptsPallets:true,delivery:'manual',autoRelease:false
  }),[8,1,-6]);
  const rackLayout=schema.warehouseRacks.layout(config(rack)),rackStock=[];
  for(const [bay,level,column]of [[0,0,0],[1,0,1],[0,1,1],[1,2,0]]){
    const sku='DEMO-STOCK-'+String(rackStock.length+1).padStart(2,'0');
    const pallet=add('product',sku+' · pallet de reserva · 4 cajas / 33 kg','pallet-loaded',{
      sourceId:rack.userData.editorId,sku,productType:'pallet',loadMode:'pallet',units:4,mass:33,manualUnpacking:true,width:1.2,depth:.8,height:.72,
      palletType:'euro-1200x800',palletMaterial:'wood',contents:'boxes',color:'#b69a6e'
    },[0,0,0]);
    const cell=rackLayout.cells.find(value=>value.bay===bay&&value.level===level&&value.column===column);
    pallet.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(pallet),center=bounds.getCenter(new THREE.Vector3());
    document.setTransform(pallet,{position:[rack.position.x+cell.position[0]-center.x,rack.position.y+cell.position[1]+.005-bounds.min.y,rack.position.z+cell.position[2]-center.z]});rackStock.push(pallet);
  }

  const dashboard=part('Supervisión · dashboard de recepción y producción','#152d38',[-8.65,1.85,-6.8],[2.8,1.575,.10],[solid(),Object.assign(schema.defaultBehavior('lineMonitor'),{targetId:source.userData.editorId,scope:'line',title:'RECEPCIÓN · PALETIZADO · DESPACHO',refreshHz:2})]);
  document.setTransform(dashboard,{rotation:[0,Math.PI/2,0]});
  // Suspend the existing screen from the actual ceiling (underside y=5.6).
  // Its digital CONTROL page remains the only set of monitor controls.
  const screenTop=dashboard.position.y+dashboard.scale.y/2,ceilingY=5.6;
  for(const z of [-7.8,-5.8]){
    part('Supervisión · tirante de techo del monitor','#314954',[-8.65,(screenTop+ceilingY)/2,z],[.065,ceilingY-screenTop,.065],[solid()]);
    part('Supervisión · anclaje superior del monitor','#314954',[-8.65,ceilingY-.025,z],[.24,.05,.24],[solid()]);
  }

  const floor=document.addIndustrialFloorPresentation(roomId,{...traffic.markings(),type:'industrialFloor',version:1,bounds:[-9,-10,15,12.5],floorY:0,
    walkways:[[-7.6,-9.5,-6,8.4],[-6,6.4,10.4,8.4],[8.4,8.4,10.4,10]],
    zones:[[-2.7,-4.3,6.5,2.6],[-5.5,-5.8,-3.2,1.7],[4.4,-8.4,11.7,-4.6],[-1.5,-7.6,1.7,-5.9]],bays:[[7.5,3,11.5,5.8]],crossings:[[8,5.5,11,6.4]],
    arrows:[[-6.8,-8,Math.PI],[-6.8,-3,Math.PI],[-6.8,3,Math.PI],[-3.5,7.4,-Math.PI/2],[2,7.4,-Math.PI/2],[7,7.4,-Math.PI/2],[9.4,9.1,Math.PI]],
    texts:['02 PALETIZADO','01 LLEGADA DE CAJAS','05 ALMACEN A01','06 DESPACHO','INGRESO','SALIDA','RUTA PEATONAL','04 RECOGIDA','SUPERVISION Y CONTROL','R1 RECOGIDA','R2 ALMACEN','R3 DESPACHO','ALTO','RUTA MONTACARGAS','PUESTO INICIAL','PASO LENTO'],
    labels:[[1.3,2.1,0,3,.45,8],[-4.3,-7.4,0,3.5,.45,9],[8,-4.7,0,3,.45,10],[9.4,5.4,0,3.4,.4,11],[-4.3,-9.2,0,2,.4,12],[9.4,9.2,0,2,.4,13],[1.5,7.9,0,3.8,.4,14],[5,2,0,2.2,.35,15],[-6.8,-6.8,Math.PI/2,3.4,.35,16],
      [9.1,-1.35,0,2,.25,17],[7.8,-3,0,2.3,.35,18],[9.2,2.4,0,2.3,.35,19],[8.6,0,Math.PI/2,.9,.3,20],[12.6,-.4,Math.PI/2,2.2,.3,21],[12.4,3.35,0,2.6,.25,22],[12.4,-4.15,0,1.9,.25,23]],
    signs:[[-5.8,5.7,0,0,4],[6.35,3.8,0,1,6],[14.45,-2.8,-Math.PI/2,1,18],[14.45,2.7,-Math.PI/2,1,19],[14.45,.2,-Math.PI/2,1,23]]});
  document.setProperty(floor,'name','DEMOSTRACIÓN · rutas R1/R2/R3 y recorrido peatonal');additions.push(floor);
  const doors=[];
  for(const [x,z,label,color,angle]of [[-4.3,-10,'INGRESO · RECEPCIÓN','#2c847b',95],[9.4,10,'SALIDA · DESPACHO','#336f95',-95]]){
    part('CEDI · explanada de '+label,'#657071',[x,-.06,z+Math.sign(z)*1.25],[6,.12,2.5],[solid(),schema.defaultBehavior('teleport'),finish('#657071')]);
    for(const [left,right]of [[-8.92,x-1.58],[x+1.58,14.92]])part('CEDI · pared de '+label,'#777e80',[(left+right)/2,2.8,z],[right-left,5.6,.16],[solid(),finish('#777e80')]);
    part('CEDI · dintel de '+label,'#777e80',[x,4.46,z],[3.16,2.28,.16],[solid(),finish('#777e80')]);
    for(const dx of [-1.54,1.54])part('Acceso · jamba de '+label,'#d4b148',[x+dx,1.65,z],[.08,3.3,.24],[solid(),finish('#d4b148')]);
    part('Acceso · marco superior de '+label,'#d4b148',[x,3.31,z],[3.16,.08,.24],[solid(),finish('#d4b148')]);
    doors.push(part('Acceso · puerta de '+label.toLowerCase(),color,[x,1.6,z],[2.98,3.2,.065],[solid(),finish(color),Object.assign(schema.defaultBehavior('hingeDoor'),{label,openAngle:angle,duration:.7,distance:4.5})]));
  }
  const message=(title,text,position,width=1.3)=>part('Guía · '+title,'#172d42',position,[width,.625*width,.025],[Object.assign(schema.defaultBehavior('info'),{
    title,text,presentation:'contextual',width,revealDistance:4.5,fadeDistance:.65,fadeTime:.22,gazeAngle:105,fontSize:.045
  })]);
  // A separate manual station uses native open cargo and individual bodies.
  part('Embalaje manual · tablero de trabajo','#52626b',[.1,.88,-6.8],[2.8,.08,1.2],[solid()]);
  for(const x of [-1.1,1.3])for(const z of [-7.25,-6.35])part('Embalaje manual · pata de mesa','#354854',[x,.42,z],[.07,.84,.07],[solid()]);
  const workpiece=(name,variant,values,x,z)=>{const object=add('product','Mesa de embalaje · '+name,variant,values,[x,1,-6.8]);object.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(object);document.setTransform(object,{position:[x,.925-box.min.y+object.position.y,z]});return object;};
  const packingBox=workpiece('caja abierta para llenado','tote',{sku:'PACK-BOX',productType:'tote',mass:.7,units:1,loadMode:'individual',packingEnabled:true,width:.4,depth:.3,height:.24,color:'#b4976b'},.85,-6.8),packingUnits=[];
  for(let i=0;i<12;i++)packingUnits.push(workpiece('botella '+(i+1),'bottle',{sku:'PACK-BOTTLE-'+(i+1),productType:'bottle',mass:.35,units:1,loadMode:'individual',width:.075,depth:.075,height:.18,color:'#75a7b7'},-.95+(i%4)*.13,-7.12+Math.floor(i/4)*.15));
  for(let i=0;i<4;i++)packingUnits.push(workpiece('pieza pequeña '+(i+1),'cylinder',{sku:'PACK-PART-'+(i+1),productType:'cylinder',mass:.15,units:1,loadMode:'individual',width:.06,depth:.06,height:.06,color:'#d6b34a'},-.95+i*.13,-6.45));
  const twoHandBox=workpiece('caja para dos manos · 12 kg','box-small',{sku:'PACK-TWO-HANDS',productType:'box',mass:12,units:1,loadMode:'individual',width:.5,depth:.32,height:.24,color:'#6c8b9c'},0,-6.8);
  const messages=[
    message('Inicio · recepción','Comienza en el monitor suspendido junto al ingreso. En RECEPCIÓN elige tipología y cantidad, prepara el lote y autoriza su entrada. En CONTROL puedes operar cada máquina. Las mercancías salen por DESPACHO, al extremo opuesto.',[-6,1.6,-8.8]),
    message('Llegada y recepción de cajas','Las unidades que autorices pasan por banda, rodillos, curva y descarga hasta el robot. El panel permite inspeccionar las tipologías admitidas, pausar las llegadas y retirar cargas libres de recepción.',[-5.3,1.6,2.2]),
    message('Una célula de paletizado','El robot agrupa las cajas recibidas en pallets de cuatro. Puedes cerrar un pallet parcial desde el panel cuando el robot libere la carga. Se conservan las mismas cajas y su masa. Observa desde fuera de la demarcación.',[-2.65,1.6,1.8]),
    message('Recogida y transporte','Agarra y gira el volante con izquierda o derecha. Gatillo derecho: acelerar. Izquierdo: frenar. A derecho: avance/reversa detenido y con el acelerador suelto. R1: recogida; R2: almacén; R3: despacho. Inserta las horquillas y eleva; baja hasta apoyar y retíralas para dejar el pallet. Transporta bajo y con suavidad.',[14.7,1.6,1.2]),
    message('Almacén A01 / R01','Doce ubicaciones reales en tres niveles alcanzables por este montacargas. Acerca el pallet a un hueco libre, nivela y baja hasta que descanse en las vigas. Después retrocede para retirar las horquillas. También puedes llevarlo a DESPACHO.',[14.7,1.6,-4.1]),
    message('Fin · despacho','Lleva el pallet a la zona DESPACHO, inspecciónalo en el panel y confirma Expedir para registrar su salida. La puerta está alineada con esta zona, al extremo opuesto de recepción. Puedes iniciar otro lote sin reiniciar el escenario.',[11,1.6,8.6]),
    message('Embalaje manual','Toma por contacto y gira la muñeca: usa Agarre del mando, o cierra los dedos con manos libres. Caja de 12 kg: dos manos. Introduce hasta 12 botellas desde arriba; puedes volver a sacarlas. Mueve los pallets cargados con el montacargas.',[.1,2.2,-7.55],1.4)
  ];
  for(const index of [3,4])document.setTransform(messages[index],{rotation:[0,-Math.PI/2,0]});
  const studio=document.studio||{},existingIds=new Set(document.getObjects(roomId).map(object=>object.userData.editorId));
  document.setStudio({groups:(studio.groups||[]).map(group=>Object.assign({},group,{members:group.members.filter(id=>existingIds.has(id))})).concat({id:'public-demo-transfer-hall',name:'Demostración · transferencia de cajas y recorrido',roomId,members:additions.map(object=>object.userData.editorId)})});
  base.objects.push(...additions);base.conveyors.push(...belts);base.sources.push(source);base.receivers.push(rack);base.links.push(...transferLinks);
  return Object.assign(base,{publicDemo:true,transfer:{source,belts,receiver,expectedUnits:8},rack,stock:rackStock[0],rackStock,rackLayout,monitors:[dashboard],dashboard,doors,messages,packingBox,packingUnits,twoHandBox,floorPresentation:floor,traffic});
}
module.exports={buildPublicDemoScene};
