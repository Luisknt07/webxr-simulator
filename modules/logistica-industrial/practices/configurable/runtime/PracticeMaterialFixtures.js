/** Finite authored stock. These are the actual product behaviours registered by
 * SimulationRuntime, never a second inventory or an endlessly generating Source.
 * Each multi-reference container records its physical units in a typed manifest.
 */
export function buildPracticeMaterialFixtures(doc,roomId,plan,rows,objects,api){
 const {add,set,queue,id,schema}=api,byAlias=alias=>{const row=rows.find(row=>row.alias===alias);return row&&doc.getObject(row.objectId);},rowFor=alias=>rows.find(row=>row.alias===alias);
 const productIds=[],sourceIds=[],receiverIds=[],processIds=[],vehicleIds=[],stocks=[],materials=[],destinations=[],machines=[],initialPoses=rows.map(row=>({alias:row.alias,position:byAlias(row.alias).position.toArray(),rotation:byAlias(row.alias).rotation.toArray().slice(0,3)}));
 const position=o=>o.position.toArray(),remember=(alias,o)=>{const row=rowFor(alias);if(row)row.componentObjectIds=(row.componentObjectIds||[]).concat(id(o));};
 const floor=(alias,name,offset=[0,0,0],size=[1.2,.8],capacity=1)=>{
  const owner=byAlias(alias),p=position(owner),seat=queue(doc,roomId,objects,alias+' · '+name,[p[0]+offset[0],offset[1],p[2]+offset[2]]);
  set(doc,seat,{width:size[0],depth:size[1],height:.16,palletHeight:.04,acceptsPallets:false,palletCapacity:1,capacity,columns:capacity,rows:1,layers:1,autoRelease:false,withPanel:false,running:true,rackSystem:'floor'});remember(alias,seat);return seat;
 };
 const seed=(alias,owner,sku,quantity,config={},offset=[0,0,0],material=sku)=>{
  const p=position(owner),q=Object.assign({sourceId:id(owner),sku,productType:'box',loadMode:'individual',units:quantity,mass:quantity*2,width:.32,depth:.3,height:.24,quality:'good',defect:'none',color:'#b9915c'},config);
  set(doc,owner,{acceptsPallets:q.loadMode==='pallet'});
  q.mass=Math.max(.01,q.mass);
  const product=add(doc,roomId,objects,'product',sku+' · '+quantity+' unidades',q.variant||'box-small',q,[p[0]+offset[0],p[1]-1+(q.loadMode==='pallet'?.005:.149)+offset[1],p[2]+offset[2]]);
  product.userData.configurableMaterialIdentity={material,quantity,lotId:'LOT-'+plan.id+'-001',orderId:'ORD-'+plan.id,unitIds:Array.from({length:quantity},(_,n)=>sku+'-U'+String(n+1).padStart(2,'0'))};
  productIds.push(id(product));if(!sourceIds.includes(id(owner)))sourceIds.push(id(owner));stocks.push({objectId:id(product),sourceId:id(owner),sku,material,quantity,lotId:'LOT-'+plan.id+'-001',unitIds:product.userData.configurableMaterialIdentity.unitIds.slice()});materials.push({objectId:id(product),sku,material,quantity});remember(alias,product);return product;
 };
 const receiver=(alias,offset=[0,0,0],name='destino físico')=>{const o=floor(alias,name,offset);receiverIds.push(id(o));destinations.push({objectId:id(o),alias,purpose:name});return o;};
 const machine=(alias,values={})=>{const o=byAlias(alias);if(!o||!doc.getBehaviors(o).some(c=>c.type==='processor'))return null;set(doc,o,Object.assign({powered:true,running:false,paused:false,requiresOperator:true,operatorAvailable:false,autoRelease:false,delivery:'manual',capacity:3,outputCapacity:12,withPanel:false,processTime:3,setupTime:1},values));processIds.push(id(o));machines.push({alias,objectId:id(o),catalogueEquipmentId:rowFor(alias).catalogueEquipmentId});return o;};
 const pallet=(alias,owner,index,boxes=8,options={})=>seed(alias,owner,plan.id+'-P'+String(index+1).padStart(2,'0'),boxes,Object.assign({variant:'pallet-loaded',productType:'pallet',loadMode:'pallet',mass:20+boxes*5,width:1.2,depth:.8,height:.72,palletType:'euro-1200x800',palletMaterial:'wood',palletTareKg:20,contents:'boxes'},options),[0,0,0],'box');
 const groupedParts=(alias,counts,groups=1)=>{
  const types={body:{productType:'crate',variant:'crate',color:'#638b9e',mass:2,width:.36,depth:.28,height:.22},lid:{productType:'crate',variant:'crate',color:'#a3acb0',mass:.2,width:.32,depth:.26,height:.12},screw:{productType:'tote',variant:'tote',color:'#d5b64e',mass:.03,width:.24,depth:.2,height:.12},carton:{productType:'box',variant:'box-small',color:'#bd9c6f',mass:.15,width:.4,depth:.32,height:.08},label:{productType:'crate',variant:'crate',color:'#eef1e4',mass:.001,width:.15,depth:.12,height:.06},finished:{productType:'crate',variant:'crate',color:'#4b998b',mass:2.32,width:.34,depth:.28,height:.24}};
  let n=0;for(let group=0;group<groups;group++)for(const material of Object.keys(counts)){
   const storage=rowFor(alias).role==='storage';let seat,offset=[0,0,0];
   if(storage){seat=byAlias(alias);if(n===0)set(doc,seat,{rackBays:3,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5,2.5',rackAisleCode:plan.id.replace(/-/g,'_'),rackRowCode:alias});const config=doc.getBehaviors(seat).find(c=>c.type==='palletQueue'),cell=schema.warehouseRacks.layout(config).cells[n];offset=[cell.x,cell.y+.856,cell.z];}
   else seat=floor(alias,material+' · lote '+(group+1),[(n%3-1)*.65,0,Math.floor(n/3)*.52]);
   const spec=types[material],quantity=counts[material];seed(alias,seat,plan.id+'-'+material.toUpperCase()+'-'+(group+1),quantity,Object.assign({},spec,{mass:quantity*spec.mass}),offset,material);n++;
  }
 };
 if(plan.id==='CEDI-02'){
  for(let i=0;i<6;i++){const seat=floor('E01','entrada P'+(i+1),[(i%3-1)*1.4,0,(1-Math.floor(i/3))*1.15]);pallet('E01',seat,i);}
  ['E02','E03'].forEach(alias=>{const o=byAlias(alias);set(doc,o,{running:true,withPanel:false,rackAisleCode:plan.id.replace(/-/g,'_'),rackRowCode:alias,rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5',rackSlotDepth:1.1,rackLevelSpacing:1.05,autoRelease:false});doc.setTransform(o,{rotation:[0,Math.PI,0]});receiverIds.push(id(o));destinations.push({objectId:id(o),alias,purpose:'reserva identificada'});});
  const refill=receiver('E04',[0,0,-1.5],'recepción de reposición · 8 cajas sobre pallet');set(doc,refill,{acceptsPallets:true});doc.setTransform(refill,{rotation:[0,Math.PI,0]});
 }else if(plan.id==='CEDI-03'){
  // Six independently identified four-carton handling bundles preserve all
  // twenty-four original cartons; the order selects three of these bundles.
  for(let i=0;i<6;i++){const alias=i<3?'E02':'E03',seat=byAlias(alias);set(doc,seat,{rackAisleCode:plan.id.replace(/-/g,'_'),rackRowCode:alias});const config=doc.getBehaviors(seat).find(c=>c.type==='palletQueue'),cell=schema.warehouseRacks.layout(config).cells[i%3];seed(alias,seat,plan.id+'-B'+(i+1),4,{variant:'carton-bundle',mass:8,width:.48,depth:.38,height:.4},[cell.x,cell.y+.856,cell.z],'box');}
  for(let i=0;i<3;i++){const o=receiver('E06',[(i-1)*.7,0,0],'pedido O'+(i+1)+' · cuatro cajas');destinations[destinations.length-1].orderId='O'+(i+1);}
  machine('E05',{capacity:1,processTime:1});
 }else if(plan.id==='CEDI-04'){
  groupedParts('E01',{finished:4,carton:4,label:4},3);machine('E02',{mode:'combiner',combineCount:3,capacity:3,processTime:3});machine('E03',{capacity:1,processTime:1});
  const o=byAlias('E04');set(doc,o,{withPanel:false,running:true,autoRelease:false,width:1.2,depth:.8,acceptsPallets:false,palletCapacity:1,layoutMode:'grid',palletize:true,palletizeLimit:2,capacity:6,columns:3,rows:2,layers:1,palletHeight:.144});
  set(doc,receiver('E06',[-.8,0,0],'pallet expedición 01'),{acceptsPallets:true});set(doc,receiver('E06',[.8,0,0],'pallet expedición 02'),{acceptsPallets:true});
 }else if(plan.id==='CEDI-05'){
  for(let i=0;i<2;i++){const seat=floor('E01','pallet liberado '+(i+1),[(i-.5)*1.4,0,0]);pallet('E01',seat,i,6);}
  const truck=byAlias('E06'),p=position(truck),bed=3.1*.37;set(doc,truck,{length:12,width:2.45,height:3.1,mode:'manual',running:false,withPanel:false});
  for(let i=0;i<2;i++)set(doc,receiver('E06',[(i-.5)*1.5+12*.17,bed,2.45*.47-.8/2-.05],'asiento de carga del camión '+(i+1)),{acceptsPallets:true});machine('E02',{capacity:1});
 }else if(plan.id==='SF-01'){
  // Two physical inbound containers, each with an explicit multi-reference BOM.
  set(doc,byAlias('E01'),{length:12,width:2.45,height:3.1,running:false,withPanel:false});
  for(let i=0;i<2;i++){const seat=floor('E01','carga multirreferencia '+(i+1),[(i-.5)*1.5+12*.17,3.1*.37,2.45*.47-.8/2-.05]);const p=pallet('E01',seat,i,36,{height:.8,mass:33.92,contents:'crates'});p.userData.configurableMaterialIdentity.materials={body:6,lid:6,screw:24};stocks[stocks.length-1].materials={body:6,lid:6,screw:24};}
  const rack=byAlias('E06');set(doc,rack,{withPanel:false,running:true,rackAisleCode:plan.id.replace(/-/g,'_'),rackRowCode:'MP01',rackBays:2,rackLevels:2,rackColumns:1,rackSlotDepth:1.1,autoRelease:false});doc.setTransform(rack,{rotation:[0,Math.PI,0]});receiverIds.push(id(rack));destinations.push({objectId:id(rack),alias:'E06',purpose:'materia prima conforme'});machine('E04',{capacity:1});
 }else if(plan.id==='SF-02'){
  groupedParts('E02',{body:4,lid:4,screw:16},3);machine('E03',{mode:'combiner',combineCount:3,capacity:3,processTime:3});
  for(let i=0;i<3;i++)receiver('E05',[(i-1)*.7,0,0],'kit K'+(i+1)+' · 4 cuerpos / 4 tapas / 16 tornillos');machine('E07',{capacity:1});
 }else if(plan.id==='SF-03'){
  for(let i=0;i<3;i++){const seat=floor('E01','contenedor de cuerpos '+(i+1),[(i-1)*.65,0,0]);seed('E01',seat,plan.id+'-BODY-'+(i+1),4,{variant:'crate',productType:'crate',mass:8,width:.36,depth:.28,height:.22,color:'#638b9e'},[0,0,0],'body');}
  machine('E02',{capacity:1,processTime:1});machine('E03',{capacity:1,processTime:4,setupTime:2});machine('E04',{capacity:1,processTime:2});receiver('E05',[-.65,0,0],'WIP conforme 01');receiver('E05',[0,0,0],'WIP conforme 02');receiver('E05',[.65,0,0],'WIP conforme 03');
 }else if(plan.id==='SF-04'){
  groupedParts('E01',{body:12,lid:12,screw:48});machine('E02',{mode:'combiner',combineCount:3,capacity:3,outputCapacity:12,processTime:6});machine('E03',{capacity:1,processTime:3,operationParametersJson:'{"testPass":true}'});
  for(let i=0;i<3;i++)set(doc,receiver('E04',[(i-1)*1.3,0,0],'conjuntos conformes '+(i*4+1)+'–'+(i*4+4)),{capacity:4,columns:2,rows:2,layers:1});
 }else if(plan.id==='SF-05'){
  groupedParts('E01',{finished:4,carton:4,label:4},3);machine('E02',{mode:'combiner',combineCount:3,capacity:3,processTime:3});
  const o=byAlias('E03');set(doc,o,{withPanel:false,running:true,autoRelease:false,width:1.2,depth:.8,acceptsPallets:false,palletCapacity:1,layoutMode:'grid',palletize:true,palletizeLimit:1,capacity:12,columns:3,rows:2,layers:2,palletHeight:.144});
  set(doc,receiver('E06',[0,0,0],'recepción interna CEDI · destino excluyente'),{acceptsPallets:true});
 }
 for(const row of rows){const o=byAlias(row.alias);if(doc.getBehaviors(o).some(c=>c.type==='vehicle'))vehicleIds.push(id(o));}
 if(plan.mode==='manual'&&['CEDI-04','SF-05'].includes(plan.id)){
  const vehicle=byAlias('E07'),source=byAlias(plan.id==='CEDI-04'?'E04':'E03');
  if(vehicle&&source){set(doc,vehicle,{powered:true,running:true,parkingBrake:true,speed:.7,reverseSpeed:.5,forkLength:1.2,loadCenter:.6,forkSpread:.48});doc.setTransform(vehicle,{position:[source.position.x,0,source.position.z+3.5],rotation:[0,Math.PI,0]});}
 }
 const quantities={};for(const stock of stocks){if(stock.materials)for(const [key,value]of Object.entries(stock.materials))quantities[key]=(quantities[key]||0)+value;else quantities[stock.material]=(quantities[stock.material]||0)+stock.quantity;}
 const palletIds=stocks.filter(row=>doc.getBehaviors(doc.getObject(row.objectId)).some(c=>c.type==='product'&&c.loadMode==='pallet')).map(row=>row.objectId),tasks=[];
 if(plan.mode!=='automatic'&&vehicleIds.length&&['CEDI-02','CEDI-05','SF-01'].includes(plan.id)){
  const vehicle=doc.getObject(vehicleIds[0]);
  for(let i=0;i<stocks.length;i++){
   const stock=stocks[i],from=doc.getObject(stock.sourceId),target=doc.getObject(receiverIds[plan.id==='CEDI-02'?Math.floor(i/3):plan.id==='CEDI-05'?i:0]),a=position(from),b=position(target),slot=plan.id==='CEDI-02'?i%3:plan.id==='SF-01'?i:0;
   const pickup={x:a[0],z:a[2]+3.5},destination={x:b[0],z:b[2]+(plan.id==='CEDI-02'||plan.id==='SF-01'?-3.5:3.5)};tasks.push({id:plan.id.toLowerCase()+'-move-'+i,name:stock.sku+' · traslado con identidad',productId:stock.objectId,sourceId:stock.sourceId,destinationId:id(target),destinationSlot:slot,pickupRoute:[pickup],route:[pickup,{x:a[0],z:0},{x:b[0],z:0},destination]});
  }
  if(plan.id==='CEDI-02')tasks.push({id:'cedi-02-replenish',name:'Reposición · ocho cajas del mismo pallet',productId:stocks[0].objectId,sourceId:receiverIds[0],destinationId:receiverIds[2],destinationSlot:0,pickupRoute:[],route:[]});
  const first=doc.getObject(stocks[0].objectId),p=position(first);set(doc,vehicle,{mode:'manual',powered:true,running:true,parkingBrake:true,forkLength:1.2,loadCenter:.6,forkSpread:.48,speed:.7,reverseSpeed:.5,trainingTasksJson:JSON.stringify(tasks),waypointsJson:'[]',routeLoop:false,detail:'balanced',cabInterior:true});doc.setTransform(vehicle,{position:[p[0],0,p[2]+3.5],rotation:[0,Math.PI,0]});
 }
 const fixtureLayoutAdjustments=initialPoses.filter(row=>byAlias(row.alias).position.toArray().some((value,i)=>Math.abs(value-row.position[i])>1e-7)||byAlias(row.alias).rotation.toArray().slice(0,3).some((value,i)=>Math.abs(value-row.rotation[i])>1e-7)).map(row=>({alias:row.alias,reason:'Aproximación inicial al material físico y apoyo de carga: la pose de dibujo se adapta sin escalar equipos, generar stock adicional ni certificar interferencias.',sourceCenter:row.position,sourceRotation:row.rotation,actualPosition:byAlias(row.alias).position.toArray(),actualRotation:byAlias(row.alias).rotation.toArray().slice(0,3),executionValidated:!!plan.availability.ready}));
 return{sourceIds,receiverIds,productIds,palletIds,vehicleIds,robotIds:rows.filter(row=>row.nativeKind==='robot'&&row.role==='robot').map(row=>row.objectId),conveyorIds:rows.filter(row=>row.nativeKind==='conveyor').map(row=>row.objectId),processIds,machineIds:processIds.slice(),tasks,links:[],fixtureLayoutAdjustments,materialRecipe:{version:1,practiceId:plan.id,orderId:'ORD-'+plan.id,stock:stocks,quantities,destinations,machines,provenance:'finite-authored-native-products; no-synthetic-generation',operationReady:false}};
}
