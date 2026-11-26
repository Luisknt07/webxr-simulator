'use strict';

/** Dedicated public recipe. Retain the physical robot/pallet/forklift cell;
 * use the other half of the room for observable carton transfers. */
function buildPublicDemoScene({THREE,schema,document,roomId,scene,base,ConveyorAssembly}) {
  if(!base||!base.robot||!base.pickup||!base.vehicle)throw new Error('Falta la célula de transferencia nativa.');
  const additions=[],machineTypes=['source','robot','conveyor','palletQueue','product'];
  const config=object=>document.getBehaviors(object).find(value=>machineTypes.includes(value.type));
  const patch=(object,changes)=>document.setBehaviors(object,document.getBehaviors(object).map(value=>machineTypes.includes(value.type)?Object.assign({},value,changes):value));
  const add=(type,name,variant,values,position)=>{const object=document.addPrefab(roomId,type,variant);patch(object,values);document.setProperty(object,'name',name);document.setTransform(object,{position});additions.push(object);return object;};
  const part=(name,color,position,scale,behaviors=[])=>{const object=document.addPrimitive(roomId,'box',color);document.setProperty(object,'name',name);document.setTransform(object,{position,scale});document.setBehaviors(object,behaviors);additions.push(object);return object;};
  const solid=()=>schema.defaultBehavior('collision');
  const finish=color=>Object.assign(schema.defaultBehavior('surfaceMaterial'),{preset:'custom',color,roughness:.88,metalness:0,colorMapMode:'none'});
  // Replace the isolated lane, the empty guide and the solid front wall.
  base.objects.slice().filter(object=>/guía de la práctica|pasillos y textos editables|pared frontal/.test(object.name)).forEach(object=>{document.remove(object);base.objects=base.objects.filter(value=>value!==object);});

  const source=add('source','DEMOSTRACIÓN · alimentación de ocho cajas',undefined,{
    running:true,autoGenerate:true,initialCount:1,totalLimit:8,capacity:2,interval:3,delivery:'automatic',withPanel:false,loadMode:'individual',generationMode:'sequence',
    catalog:JSON.stringify([
      {id:'demo-carton-natural',name:'Caja de recepción',type:'box',variant:'box-small',width:.3,depth:.3,height:.22,mass:2,base:'flat',color:'#b98d53',quality:'good',defect:'none'},
      {id:'demo-carton-blue',name:'Caja de clasificación azul',type:'box',variant:'box-small',width:.28,depth:.28,height:.24,mass:2,base:'flat',color:'#4e8c9d',quality:'good',defect:'none'}
    ])
  },[-6.7,1,-6.8]);
  const belts=[
    add('conveyor','DEMOSTRACIÓN · 01 banda de alimentación','belt-start',{length:2.4},[0,1,0]),
    add('conveyor','DEMOSTRACIÓN · 02 transferencia a rodillos','roller-middle',{length:1.8},[0,1,0]),
    add('conveyor','DEMOSTRACIÓN · 03 curva de transferencia','belt-curve-right',{radius:.95,curveAngle:90},[0,1,0]),
    add('conveyor','DEMOSTRACIÓN · 04 banda de descarga de cajas','belt-end',{length:1.2},[0,1,0])
  ];
  belts.forEach((belt,index)=>patch(belt,{powered:true,running:true,autoSpawn:false,withPanel:index===0,withSensors:index===0,width:.65,supportHeight:1,speed:.32,maxPackages:6,maxLoad:25,clearance:.12}));
  const receiver=add('palletQueue','DEMOSTRACIÓN · recepción de ocho cajas transferidas',undefined,{
    running:true,withPanel:false,acceptsPallets:false,palletType:'custom',width:1.2,depth:1.8,palletCapacity:1,capacity:8,columns:2,rows:4,layers:1,autoRelease:false,delivery:'manual',layoutMode:'grid'
  },[0,1,0]);
  const assembly=new ConveyorAssembly({document,roomId,root:document.getRoot(roomId),ctx:{scene},hooks:{renderScene:scene},assemblyMessage(){}}),transferLinks=[];
  try{const chain=[source,...belts,receiver];for(let i=1;i<chain.length;i++){
    const from=chain[i-1],to=chain[i];
    if(!assembly.align(from,'output',to,'input')||!assembly.connect(assembly.pair(to,'input',from,'output')))throw new Error('No se pudo conectar la línea de cajas: '+from.name);
    transferLinks.push({source:from.userData.editorId,sourcePort:'output',target:to.userData.editorId,targetPort:'input'});
  }}finally{assembly.clear();}

  const rack=add('palletQueue','DEMOSTRACIÓN · rack doble de tres niveles A01 / R01','selective',Object.assign({},schema.warehouseRacks.defaults('selective'),{
    running:true,withPanel:false,rackBays:2,rackLevels:3,rackColumns:2,rackBayWidth:3,rackBaseHeight:.3,rackLevelHeight:1.4,rackSlotDepth:1.1,
    rackAisleCode:'A01',rackRowCode:'R01',rackAssignments:'[]',acceptsPallets:true,delivery:'manual',autoRelease:false
  }),[8,1,-6]);
  const rackLayout=schema.warehouseRacks.layout(config(rack)),rackStock=[];
  for(const [bay,level,column]of [[0,0,0],[1,0,1],[0,1,1],[1,2,0]]){
    const sku='DEMO-STOCK-'+String(rackStock.length+1).padStart(2,'0');
    const pallet=add('product',sku+' · pallet de reserva · 4 cajas / 33 kg','pallet-loaded',{
      sourceId:rack.userData.editorId,sku,productType:'pallet',loadMode:'pallet',units:4,mass:33,width:1.2,depth:.8,height:.72,
      palletType:'euro-1200x800',palletMaterial:'wood',contents:'boxes',color:'#b69a6e'
    },[0,0,0]);
    const cell=rackLayout.cells.find(value=>value.bay===bay&&value.level===level&&value.column===column);
    pallet.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(pallet),center=bounds.getCenter(new THREE.Vector3());
    document.setTransform(pallet,{position:[rack.position.x+cell.position[0]-center.x,rack.position.y+cell.position[1]+.005-bounds.min.y,rack.position.z+cell.position[2]-center.z]});rackStock.push(pallet);
  }

  const floor=document.addIndustrialFloorPresentation(roomId,{type:'industrialFloor',version:1,bounds:[-9,-10,15,12.5],floorY:0,
    walkways:[[-7.4,-2.4,-5.4,10],[-5.4,6.4,13,8.4],[11,8.4,13,10]],
    zones:[[-2.7,-2.4,6.5,2.6],[-8,-8.2,1.2,-2.6],[4.4,-8.4,11.7,-4.6]],bays:[[7.5,3,11.5,5.8]],crossings:[[8,5.5,11,6.4]],
    arrows:[[-6.4,8,0],[-6.4,3,0],[-3.5,7.4,-Math.PI/2],[2,7.4,-Math.PI/2],[7,7.4,-Math.PI/2],[12,9.1,Math.PI]],
    texts:['CELDA ROBOT','CAJAS EN TRANSFERENCIA','ALMACEN A01','ENTREGA DE PALLETS','INGRESO','SALIDA','RUTA PEATONAL'],
    labels:[[1.3,2.1,0,3,.45,8],[-3.6,-2.9,0,4,.5,9],[8,-4.7,0,3,.45,10],[9.4,5.4,0,3.4,.4,11],[-6.4,8.7,0,1.65,.4,12],[12,8.7,0,1.65,.4,13],[1.5,7.9,0,3.8,.4,14]],
    signs:[[-5.3,5.7,0,0,4],[6.7,3.6,0,1,6]]});
  document.setProperty(floor,'name','DEMOSTRACIÓN · áreas y recorrido peatonal');additions.push(floor);
  part('CEDI · explanada de acceso','#657071',[3,-.06,11.25],[24,.12,2.5],[solid(),schema.defaultBehavior('teleport'),finish('#657071')]);
  for(const [left,right]of [[-8.92,-7.08],[-4.92,10.92],[13.08,14.92]])part('CEDI · pared frontal entre accesos','#777e80',[(left+right)/2,2.8,10],[right-left,5.6,.16],[solid(),finish('#777e80')]);
  const doors=[];
  for(const [x,label,color]of [[-6,'INGRESO','#2c847b'],[12,'SALIDA','#336f95']]){
    part('CEDI · dintel de '+label,'#777e80',[x,4.125,10],[2.16,2.95,.16],[solid(),finish('#777e80')]);
    for(const dx of [-1.04,1.04])part('Acceso · jamba de '+label,'#d4b148',[x+dx,1.33,10],[.08,2.66,.24],[solid(),finish('#d4b148')]);
    part('Acceso · marco superior de '+label,'#d4b148',[x,2.67,10],[2.16,.10,.24],[solid(),finish('#d4b148')]);
    doors.push(part('Acceso · puerta de '+label.toLowerCase(),color,[x,1.27,10],[1.90,2.52,.065],[solid(),finish(color),Object.assign(schema.defaultBehavior('hingeDoor'),{label,openAngle:-95,duration:.7,distance:3.2})]));
  }
  const message=(title,text,position,width=1.3)=>part('Guía · '+title,'#172d42',position,[width,.625*width,.025],[Object.assign(schema.defaultBehavior('info'),{
    title,text,presentation:'contextual',width,revealDistance:4.5,fadeDistance:.65,fadeTime:.22,gazeAngle:105,fontSize:.045
  })]);
  const messages=[
    message('Bienvenido a la instalación','Sigue la ruta peatonal verde. Pulsa las puertas para abrirlas. Observa la transferencia de cajas, la célula robotizada y el almacén; cada estación tiene una guía al acercarte.',[-5.25,1.6,8.6]),
    message('Cajas de banda en banda','Ocho cajas recorren banda, rodillos, curva y descarga. Sigue cada caja en los empalmes y observa el cambio de superficie. Usa el panel de la primera banda para detenerla y reanudar la alimentación.',[-4.7,1.6,-3.1]),
    message('Una célula de paletizado','El robot toma ocho cajas individuales y forma dos pallets de cuatro cajas. Observa su herramienta y sus movimientos desde fuera de la demarcación amarilla.',[-2.65,1.6,1.2]),
    message('Recogida y transporte','Detén la banda antes de recoger el pallet. Sube al montacargas con F o seleccionando su acceso, libera Freno P y alinea ambas horquillas. Deposita en las bahías demarcadas.',[5.7,1.6,2.9]),
    message('Almacén A01 / R01','Dos módulos, tres niveles y doce ubicaciones reales. Cuatro pallets de reserva y ocho posiciones libres. Detén el vehículo antes de elevar; recoge y deposita de frente.',[7.8,1.6,-3.8]),
    message('Salida del recorrido','Sigue las flechas hasta la puerta SALIDA. Puedes volver a explorar o reiniciar la demostración desde el menú para repetir ambos procesos con los mismos lotes finitos.',[11,1.6,8.6])
  ];
  const studio=document.studio||{},existingIds=new Set(document.getObjects(roomId).map(object=>object.userData.editorId));
  document.setStudio({groups:(studio.groups||[]).map(group=>Object.assign({},group,{members:group.members.filter(id=>existingIds.has(id))})).concat({id:'public-demo-transfer-hall',name:'Demostración · transferencia de cajas y recorrido',roomId,members:additions.map(object=>object.userData.editorId)})});
  base.objects.push(...additions);base.conveyors.push(...belts);base.sources.push(source);base.receivers.push(receiver,rack);base.links.push(...transferLinks);
  return Object.assign(base,{publicDemo:true,transfer:{source,belts,receiver,expectedUnits:8},rack,stock:rackStock[0],rackStock,rackLayout,monitors:[],doors,messages,floorPresentation:floor});
}
module.exports={buildPublicDemoScene};
