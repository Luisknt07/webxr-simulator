import * as THREE from 'three';
import schema from '../../../contracts/behaviors.js';
import cediLayout from '../CediLayout.cjs';

// Persisted native architecture shared by all five CEDI exercises. Equipment,
// pallets and operational controls are separate actors owned by the workflow.
const FINISHES={
 wall:{name:'Cerramientos industriales',color:'#c3c9c7',preset:'paintedMetal',roughness:.82,wear:.07,wearType:'dirt'},
 concrete:{name:'Hormigón de pisos y cimentación',color:'#929994',preset:'concrete',roughness:.94,wear:.12,wearType:'dirt'},
 paving:{name:'Pavimento de patio',color:'#626c6b',preset:'concrete',roughness:.98,wear:.17,wearType:'dirt'},
 terrain:{name:'Terreno del parque industrial',color:'#75806d',preset:'concrete',roughness:1,wear:.14,wearType:'dirt'},
 steel:{name:'Perfiles estructurales',color:'#455b62',preset:'paintedMetal',roughness:.65,wear:.09,wearType:'chips'},
 roof:{name:'Cubierta y bandejas',color:'#b2bdbe',preset:'steel',roughness:.71,metalness:.4,wear:.05},
 trim:{name:'Herrajes galvanizados',color:'#b7c4c6',preset:'steel',metalness:.78,roughness:.48,wear:.06},
 rubber:{name:'Sellos y topes de muelle',color:'#26343a',preset:'rubber',roughness:.93,wear:.12},
 yellow:{name:'Protecciones y demarcaciones',color:'#d8ae32',preset:'paintedMetal',roughness:.79,wear:.12,wearType:'chips'},
 white:{name:'Pintura vial blanca',color:'#e7ece5',preset:'custom',roughness:.98},
 glass:{name:'Ventanas y policarbonato difusor',color:'#a5bdc6',preset:'custom',roughness:.38,emissiveMode:'custom',emissive:'#9cb7c2',emissiveIntensity:.17},
 light:{name:'Luminarias LED',color:'#f8f5e8',preset:'custom',roughness:.64,emissiveMode:'custom',emissive:'#fff3dc',emissiveIntensity:1.15},
 green:{name:'Evacuación y recorrido peatonal',color:'#328575',preset:'paintedMetal',roughness:.94},
 red:{name:'Equipamiento contra incendios',color:'#b84236',preset:'paintedMetal',roughness:.7,wear:.1},
 wood:{name:'Mobiliario de administración',color:'#a58b64',preset:'wood',roughness:.83,wear:.08},
 porcelain:{name:'Sanitarios y lavamanos',color:'#e6e9e2',preset:'custom',roughness:.28},
 lockers:{name:'Casilleros y armarios de servicio',color:'#738d99',preset:'paintedMetal',roughness:.72,wear:.1}
};
const round=value=>Math.round(value*1e6)/1e6;
const material=key=>Object.assign(schema.defaultBehavior('surfaceMaterial'),{colorMapMode:'preserve',metalness:0,roughness:.8,clearcoat:0,repeatX:.2,repeatY:.2,seed:451},FINISHES[key]);

export function buildCediFacility(doc,roomId,plan,objects=[]){
 if(!/^CEDI-0[1-5]$/.test(plan.id))throw Error('La instalación compartida corresponde a CEDI-01 a CEDI-05.');
 const layout=cediLayout.layout(),bounds=layout.bounds,created=[],floors=[],parts=[],batches=new Map(),openings=[];
 const boxGeometry=new THREE.BoxBufferGeometry(1,1,1).toNonIndexed(),cylinderGeometry=new THREE.CylinderBufferGeometry(1,1,1,8,1).toNonIndexed();
 const vertex=new THREE.Vector3(),matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion();
 function geometry(key,source,position,scale,rotation,solid=false,partition='',role='detail'){
  const batchId=key+':'+(solid?'solid:'+partition:'detail'),array=source.attributes.position.array;
  if(!batches.has(batchId))batches.set(batchId,{key,solid,partition,role,positions:[],parts:0});
  const batch=batches.get(batchId);quaternion.setFromEuler(new THREE.Euler(...rotation));matrix.compose(new THREE.Vector3(...position),quaternion,new THREE.Vector3(...scale));
  for(let n=0;n<array.length;n+=3){vertex.set(array[n],array[n+1],array[n+2]).applyMatrix4(matrix);batch.positions.push(round(vertex.x),round(vertex.y),round(vertex.z));}
  batch.parts++;
 }
 function box(key,position,scale,solid=false,partition='',rotation=[0,0,0],role='detail'){
  if(position.concat(scale,rotation).some(value=>!Number.isFinite(value))||scale.some(value=>value<=0))throw Error('Geometría de instalación CEDI inválida.');
  geometry(key,boxGeometry,position,scale,rotation,solid,partition,role);if(solid)parts.push({finish:key,position,scale,rotation,partition});
 }
 function cylinder(key,position,radius,length,rotation=[0,0,0],solid=false,partition='',role='detail'){geometry(key,cylinderGeometry,position,[radius,length,radius],rotation,solid,partition,role);}
 function beam(key,from,to,thickness=.06,solid=false,partition='',role='detail'){const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),length=a.distanceTo(b),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());box(key,a.add(b).multiplyScalar(.5).toArray(),[thickness,length,thickness],solid,partition,new THREE.Euler().setFromQuaternion(q).toArray().slice(0,3),role);}
 const own=object=>{objects.push(object);created.push(object);return object;};
 function slab(name,rect,top,key='concrete',role='ground'){
  const width=rect[2]-rect[0],depth=rect[3]-rect[1],object=doc.addPrimitive(roomId,'box',FINISHES[key].color);
  doc.setProperty(object,'name',name);doc.setTransform(object,{position:[(rect[0]+rect[2])/2,top-.12,(rect[1]+rect[3])/2],scale:[width,.24,depth]});
  doc.setBehaviors(object,[schema.defaultBehavior('collision'),schema.defaultBehavior('teleport'),Object.assign(material(key),{repeatX:width/4,repeatY:depth/4})]);object.userData.practiceFacility={role,layoutId:layout.id,finish:key};floors.push(object);return own(object);
 }
 function groundRect(rect,key,partition){box(key,[(rect[0]+rect[2])/2,layout.apronY-.12,(rect[1]+rect[3])/2],[rect[2]-rect[0],.24,rect[3]-rect[1]],true,partition,[0,0,0],'outdoor-ground');}
 function surround(outer,inner){return[[outer.minX,outer.minZ,inner.minX,outer.maxZ],[inner.maxX,outer.minZ,outer.maxX,outer.maxZ],[inner.minX,outer.minZ,inner.maxX,inner.minZ],[inner.minX,inner.maxZ,inner.maxX,outer.maxZ]].filter(rect=>rect[2]>rect[0]&&rect[3]>rect[1]);}
 function subtract(rect,cut){const[x0,z0,x1,z1]=rect,a=Math.max(x0,cut[0]),b=Math.max(z0,cut[1]),c=Math.min(x1,cut[2]),d=Math.min(z1,cut[3]);return c<=a||d<=b?[rect]:[[x0,z0,a,z1],[c,z0,x1,z1],[a,z0,c,b],[a,d,c,z1]].filter(row=>row[2]-row[0]>.00001&&row[3]-row[1]>.00001);}
 function wall(axis,coordinate,min,max,height,holes=[],base=0,key='wall'){
  const cut=[min,max].concat(holes.flatMap(h=>[h.center-h.width/2,h.center+h.width/2])).filter(value=>value>=min&&value<=max).sort((a,b)=>a-b),point=(along,y,offset=0)=>axis==='x'?[along,y,coordinate+offset]:[coordinate+offset,y,along],scale=(length,h,t)=>axis==='x'?[length,h,t]:[t,h,length];
  for(let i=1;i<cut.length;i++){
   const a=cut[i-1],b=cut[i];if(b-a<.0001)continue;const middle=(a+b)/2,active=holes.filter(h=>middle>h.center-h.width/2&&middle<h.center+h.width/2),ys=[base,height].concat(active.flatMap(h=>[h.bottom||0,h.height])).filter(value=>value>=base&&value<=height).sort((a,b)=>a-b);
   for(let j=1;j<ys.length;j++){const low=ys[j-1],high=ys[j];if(high-low<.0001||active.some(h=>(low+high)/2>(h.bottom||0)&&(low+high)/2<h.height))continue;box(key,point(middle,(low+high)/2),scale(b-a,high-low,.18),true,'wall:'+axis+':'+coordinate,[0,0,0],'envelope');}
  }
 }
 function frameDoor(axis,at,center,width,height,colour='steel'){
  const point=(along,y)=>axis==='x'?[along,y,at]:[at,y,along],scale=(length,h,t)=>axis==='x'?[length,h,t]:[t,h,length];
  for(const side of [-1,1])box(colour,point(center+side*(width/2+.08),height/2),scale(.1,height,.25));
  box(colour,point(center,height+.06),scale(width+.26,.12,.25));
 }
 function paintRect(rect,key,y,thickness=.075){const w=rect[2]-rect[0],d=rect[3]-rect[1],x=(rect[0]+rect[2])/2,z=(rect[1]+rect[3])/2;for(const side of [-1,1]){box(key,[x+side*(w-thickness)/2,y,z],[thickness,.008,d]);box(key,[x,y,z+side*(d-thickness)/2],[w-thickness*2,.008,thickness]);}}
 function ramp(){
  const [x0,z0,x1,z1]=layout.aisles.pedestrianRamp.rect,y0=0,y1=layout.apronY,bottom=layout.apronY-.24;
  const corners=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z1],[x0,y1,z1],[x0,bottom,z0],[x1,bottom,z0],[x1,bottom,z1],[x0,bottom,z1]],triangles=[[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]],g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(triangles.flatMap(face=>face.flatMap(index=>corners[index])),3));
  geometry('concrete',g,[0,0,0],[1,1,1],[0,0,0],true,'pedestrian-ramp','outdoor-ground');g.dispose();
  for(const side of [-1,1]){const x=side*1.75;beam('trim',[x,.95,z0],[x,y1+.95,z1],.055,true,'outdoor:ramp-rail:'+side,'outdoor-envelope');for(let z=z0;z<=z1;z+=2){const y=y0+(y1-y0)*(z-z0)/(z1-z0);cylinder('trim',[x,y+.46,z],.025,.92);}}
 }
 function fence(axis,coordinate,min,max,holes=[],prefix='site'){
  const cut=[min,max].concat(holes.flatMap(h=>[h.center-h.width/2,h.center+h.width/2])).sort((a,b)=>a-b),point=(along,y)=>axis==='x'?[along,layout.apronY+y,coordinate]:[coordinate,layout.apronY+y,along],scale=(length,h,t)=>axis==='x'?[length,h,t]:[t,h,length],partition='outdoor:'+prefix+':'+axis+':'+coordinate;
  for(let i=1;i<cut.length;i++){const a=cut[i-1],b=cut[i],middle=(a+b)/2;if(a<min||b>max||b-a<.001||holes.some(h=>middle>h.center-h.width/2&&middle<h.center+h.width/2))continue;
   for(const y of [.4,1.15,2.1])box('steel',point(middle,y),scale(b-a,y===.4?.18:.05,.065),true,partition,[0,0,0],'outdoor-envelope');
   const bars=Math.ceil((b-a)/.45);for(let n=0;n<=bars;n++)box('steel',point(a+(b-a)*n/bars,1.15),scale(.012,1.9,.012),true,partition,[0,0,0],'outdoor-envelope');
   const posts=Math.ceil((b-a)/3.2);for(let n=0;n<=posts;n++)box('steel',point(a+(b-a)*n/posts,1.14),scale(.09,2.28,.09),true,partition,[0,0,0],'outdoor-envelope');
  }
 }
 function furniture(){
  const fixtures=[];
  const desk=(id,x,z)=>{box('wood',[x,.77,z],[2,.1,.85],true,'support:'+id,[0,0,0],'support-fixture');for(const dx of [-.85,.85])for(const dz of [-.3,.3])box('steel',[x+dx,.36,z+dz],[.06,.72,.06]);box('rubber',[x,.98,z+.2],[.55,.38,.055]);box('glass',[x,.98,z+.166],[.48,.3,.012]);box('rubber',[x,.835,z-.15],[.5,.025,.18]);box('rubber',[x,.45,z-.85],[.48,.12,.48]);box('rubber',[x,.76,z-1.05],[.48,.58,.1]);for(const dx of [-.18,.18])box('steel',[x+dx,.2,z-.85],[.04,.4,.04]);fixtures.push({id,kind:'desk-screen-chair',position:[x,0,z]});};
  desk('office',-6,21);desk('control',-7,16.9);
  for(let n=0;n<6;n++){const z=14.55+n*.5;box('lockers',[8.6,.93,z],[.55,1.86,.46],true,'support:lockers',[0,0,0],'support-fixture');box('trim',[8.31,1.05,z+.12],[.025,.16,.025]);for(const y of [.35,1.5])box('rubber',[8.312,y,z],[.012,.035,.28]);}
  box('wood',[4.9,.48,16.8],[2.6,.09,.45],true,'support:locker-bench',[0,0,0],'support-fixture');for(const x of [3.85,5.95])box('steel',[x,.23,16.8],[.06,.46,.32]);fixtures.push({id:'lockers',kind:'six-lockers-and-bench',position:[8.6,0,16]});
  for(const z of [19,21]){cylinder('porcelain',[8.05,.35,z],.27,.45,[0,0,0],true,'support:sanitary-row','support-fixture');box('porcelain',[8.05,.58,z+.3],[.5,.52,.2],true,'support:sanitary-row',[0,0,0],'support-fixture');cylinder('rubber',[8.05,.59,z-.05],.23,.045);box('wall',[7.2,1.05,z+.65],[1.3,2.1,.065]);}
  box('porcelain',[3.1,.8,21.5],[1.2,.2,.48],true,'support:basin',[0,0,0],'support-fixture');cylinder('trim',[3.1,1.015,21.6],.025,.24);box('glass',[3.1,1.55,21.73],[1.05,.8,.025]);fixtures.push({id:'restrooms',kind:'two-toilets-basin-mirror',position:[8.05,0,20]});
  box('steel',[-30.3,.85,-14],[1,.12,5.2],true,'support:maintenance',[0,0,0],'support-fixture');for(const z of [-16,-12])box('steel',[-30.3,.4,z],[.75,.8,.07]);box('lockers',[-28.4,.95,-18.4],[2,1.9,.65],true,'support:maintenance-cabinet',[0,0,0],'support-fixture');
  for(let n=0;n<5;n++){box('trim',[-30.3,.96,-15.8+n*.75],[.25,.1,.16]);cylinder('rubber',[-30.1,1.04,-15.8+n*.75],.07,.15,[0,0,Math.PI/2]);}fixtures.push({id:'maintenance',kind:'workbench-tool-nests-service-cabinet',position:[-30.3,0,-14]});
  // Shelving and flattened empty packs are support-room furnishings; they do
  // not substitute the operational packaging stock created by the recipe.
  for(const x of [-7.4,-4.5,-1.6])for(const z of [8.5,11.5])box('steel',[x,1.05,z],[.055,2.1,.055]);for(const y of [.25,1,1.75])box('wood',[-4.5,y,10],[5.9,.07,3]);for(let n=0;n<6;n++)box('wood',[-6.8+n*.85,1.17,10],[.7,.22,.9]);fixtures.push({id:'empty-packaging',kind:'shelves-empty-folded-packs',position:[-4.5,0,10]});
  return fixtures;
 }
 try{
  const floor=slab('CEDI compartido · piso interior de hormigón 64 × 44 m',[-32,-22,32,22],0);
  const roads=[[-34,58,-24,82],[24,58,34,82]],pavingRects=surround(layout.siteBounds,bounds).concat(roads),terrainRects=roads.reduce((rects,cut)=>rects.flatMap(rect=>subtract(rect,cut)),surround(layout.groundBounds,layout.siteBounds));
  for(const rect of pavingRects)groundRect(rect,'paving','outdoor:paving');for(const rect of terrainRects)groundRect(rect,'terrain','outdoor:terrain');ramp();
  const frontHoles=layout.docks.map(d=>({center:d.center,width:d.width,bottom:0,height:d.height})).concat([{center:0,width:2.2,height:2.6},{center:-5.5,width:4.4,bottom:1.1,height:2.45},{center:5.5,width:3.5,bottom:2.35,height:3.05}]);
  wall('x',22,-32,32,9.2,frontHoles,layout.apronY);wall('x',-22,-32,32,9.2,[],layout.apronY);wall('z',-32,-22,22,9.2,[],layout.apronY);wall('z',32,-22,22,9.2,[],layout.apronY);
  // Raised plinth surfaces and manufactured seams have a real normal offset.
  for(const z of [-22,22]){box('concrete',[0,-.58,z+Math.sign(z)*.101],[64,1.14,.018]);for(let x=-30;x<32;x+=3){if(z===22&&frontHoles.some(h=>x>h.center-h.width/2&&x<h.center+h.width/2))continue;box('trim',[x,4.8,z+Math.sign(z)*.107],[.026,8.4,.027]);}}
  for(const x of [-32,32]){box('concrete',[x+Math.sign(x)*.101,-.58,0],[.018,1.14,44]);for(let z=-20;z<22;z+=3)box('trim',[x+Math.sign(x)*.107,4.8,z],[.027,8.4,.026]);}
  box('glass',[-5.5,1.775,22],[4.4,1.35,.06],true,'front-glazing',[0,0,0],'envelope');box('glass',[5.5,2.7,22],[3.5,.7,.06],true,'front-glazing',[0,0,0],'envelope');frameDoor('x',22,0,2.2,2.6,'green');
  for(const dock of layout.docks){
   openings.push({...dock,purpose:dock.purpose==='receiving'?'Recepción':'Despacho'});frameDoor('x',22,dock.center,dock.width,dock.height);
   for(const side of [-1,1]){box('rubber',[dock.center+side*2.28,2.4,22.12],[.3,4.8,.34]);box('rubber',[dock.center+side*1.75,-.28,22.28],[.3,.85,.3]);box('yellow',[dock.center+side*2.48,.6,21.65],[.17,1.2,.17]);}
   box('rubber',[dock.center,4.98,22.12],[4.86,.28,.34]);box('roof',[dock.center,5.3,22],[4.65,.42,.5]);
   // The fixed transfer plate is flush with both warehouse and truck deck.
   // Its full thickness sits below the support plane so a pallet may approach
   // at its declared seated height without catching an artificial raised lip.
   box('trim',[dock.center,-.045,21.65],[2.9,.09,1.7],true,'dock-bridges',[0,0,0],'dock-bridge');
   for(const x of [-.85,.85]){cylinder('trim',[dock.center+x,-.28,21.8],.055,.55,[Math.PI/4,0,0]);box('steel',[dock.center+x,-.5,21.9],[.12,.08,.7]);}
   for(const side of [-1,1])box('yellow',[dock.center+side*1.85,layout.apronY+.1,28.6],[.12,.2,5.6],true,'outdoor:dock-guides:'+dock.id,[0,0,0],'outdoor-envelope');
   paintRect([dock.center-2.45,23.1,dock.center+2.45,36.4],'yellow',layout.apronY+.012);
  }
  openings.push({id:'STAFF-ENTRY',side:'front',axis:'x',wallCoordinate:22,center:0,width:2.2,height:2.6,purpose:'Acceso peatonal'});
  // Service-block partitions are individual thin planes, never one hollow
  // closed CAD enclosing the staff's free walking space.
  wall('x',14,-9,9,3.2,[{center:-5.5,width:1.3,height:2.25},{center:0,width:3.6,height:2.6},{center:5.5,width:1.3,height:2.25}]);wall('x',18,-9,9,3.2,[{center:0,width:4,height:3.2}]);
  for(const x of [-9,-2,2,9])wall('z',x,14,22,3.2,(x===-2||x===2)?[{center:20,width:1.25,height:2.25}]:[]);
  wall('z',-26,-19,-9,3.2,[{center:-13,width:1.6,height:2.45}]);wall('z',-31,-19,-9,3.2);for(const z of [-19,-9])wall('x',z,-31,-26,3.2);
  for(const room of layout.rooms){const door=room.door;frameDoor(door.axis,door.coordinate,door.center,door.width,door.height);}
  box('roof',[0,3.25,18],[18.2,.1,8.2]);box('roof',[-28.5,3.25,-14],[5.2,.1,10.2]);
  for(const[x,z]of [[-5.5,20],[-5.5,16],[5.5,16],[5.5,20],[-28.5,-14]])box('light',[x,3.17,z],[1.1,.025,.48]);
  const fixtures=furniture();
  for(const z of [-18,-6,6,18]){
   for(const x of [-31.7,31.7]){box('steel',[x,4.6,z],[.24,9.2,.34],true,'structure:'+Math.sign(x),[0,0,0],'envelope');box('trim',[x,.06,z],[.6,.12,.65]);box('yellow',[x,.58,z],[.48,1.1,.5]);}
   box('steel',[0,8.55,z],[63.5,.17,.3]);box('steel',[0,9.02,z],[63.5,.1,.35]);
   for(let x=-31.5;x<31;x+=5.25){beam('steel',[x,8.5,z],[x+5.25,8.98,z]);beam('steel',[x,8.98,z],[x+5.25,8.5,z]);}
  }
  box('roof',[0,9.26,0],[64.4,.12,44.4],true,'main-roof',[0,0,0],'roof');
  for(let x=-31;x<=31;x+=2)box('trim',[x,9.18,0],[.024,.035,44]);
  for(const x of [-21,0,21])for(const z of [-15,-5,5,15]){box('steel',[x,8.05,z],[2.35,.12,.55]);box('light',[x,7.978,z],[2.15,.025,.44]);for(const side of [-1,1])cylinder('trim',[x+side*.85,8.6,z],.012,1);}
  for(const x of [-24,24]){box('roof',[x,8.4,0],[.38,.04,42]);for(const side of [-1,1])box('roof',[x+side*.2,8.47,0],[.03,.15,42]);for(let z=-20;z<=20;z+=2)box('trim',[x,8.45,z],[.38,.025,.04]);}
  for(const [x,z]of [[-30.8,20],[30.8,20],[-30.8,-20],[30.8,-20]]){cylinder('red',[x,.95,z],.11,.58);cylinder('trim',[x,1.28,z],.035,.06);box('rubber',[x,1.35,z],[.2,.045,.075]);cylinder('rubber',[x+.13,1,z],.017,.45);box('steel',[x,.63,z],[.25,.04,.2]);}
  const site=layout.siteBounds;fence('z',site.minX,site.minZ,site.maxZ);fence('z',site.maxX,site.minZ,site.maxZ);fence('x',site.minZ,site.minX,site.maxX);fence('x',site.maxZ,site.minX,site.maxX,[{center:-29,width:10},{center:29,width:10},{center:0,width:3.2}]);
  const boundary=layout.worldBoundary;
  for(const x of [boundary.minX,boundary.maxX])box('concrete',[x,layout.apronY+1.2,(boundary.minZ+boundary.maxZ)/2],[boundary.thickness,2.4,boundary.maxZ-boundary.minZ],true,'outdoor:world:x:'+x,[0,0,0],'outdoor-envelope');
  for(const z of [boundary.minZ,boundary.maxZ])box('concrete',[(boundary.minX+boundary.maxX)/2,layout.apronY+1.2,z],[boundary.maxX-boundary.minX,2.4,boundary.thickness],true,'outdoor:world:z:'+z,[0,0,0],'outdoor-envelope');
  for(let z=26;z<51;z+=5){paintRect([-45,z,-39,z+2.7],'white',layout.apronY+.012);box('rubber',[-44.6,layout.apronY+.09,z+1.35],[.15,.18,2]);}
  for(const x of [-29,29])for(let z=43;z<78;z+=4)box('white',[x,layout.apronY+.012,z],[.14,.008,1.8]);
  for(const side of [-1,1])box('white',[side*1.03,layout.apronY+.012,47],[.055,.008,22]);
  const text=['CEDI · FLUJO EN U','REC-01','REC-02','DES-01','DES-02','ALMACENAMIENTO','PICKING','EMPAQUE','CUARENTENA','EMBALAJES VACÍOS','ADMINISTRACIÓN','SERVICIOS HIGIÉNICOS','VESTUARIO','MANTENIMIENTO','SALIDA','RECEPCIÓN','DESPACHO'];
  const marks=doc.addIndustrialFloorPresentation(roomId,{type:'industrialFloor',version:1,bounds:[-32,-22,32,22],floorY:.008,texts:text,
   walkways:layout.aisles.pedestrianRects,zones:Object.values(layout.zones).filter(zone=>zone.kind==='operations').map(zone=>zone.rect),bays:[],crossings:layout.aisles.crossings,
   arrows:[[-12,9,Math.PI],[-12,-2,Math.PI],[-4,-7,Math.PI/2],[10,-7,Math.PI/2],[27,2,0],[27,13,0]],
   labels:[[-22,20.5,0,3,.4,9],[-14,20.5,0,3,.4,10],[14,20.5,0,3,.4,11],[22,20.5,0,3,.4,12],[-1,-19,0,7,.6,13],[13,3.8,0,5,.4,14],[16,11.3,0,5,.4,15],[-4.5,6.3,0,5,.4,16],[-4.5,11.5,0,5,.4,17],[0,21,0,1.8,.32,22]],
   signs:[[-28.7,9,0,1,23],[24,13,Math.PI,1,24],[-8.5,13.5,0,0,18],[2.5,18.2,0,0,19],[2.6,14.2,0,0,20],[-25.6,-10,0,1,21],[-30.5,19,0,1,6],[30.5,19,0,1,6]]});
  doc.setProperty(marks,'name','CEDI compartido · señalética, rutas peatonales y zonas');doc.setBehaviors(marks,[Object.assign(schema.defaultBehavior('collision'),{enabled:false})]);marks.userData.practiceFacility={role:'signage',layoutId:layout.id};own(marks);
  let triangles=0;
  for(const batch of batches.values()){
   const positions=batch.positions,descriptor={type:'cad',recipe:{steps:[{id:'s1',op:'primitive.mesh',params:{positions},inputs:[]}],output:'s1'},mesh:{positions},color:FINISHES[batch.key].color,smoothingAngle:0},object=doc.addCAD(roomId,descriptor);
   doc.setProperty(object,'name','CEDI compartido · '+FINISHES[batch.key].name+(batch.solid?' · '+batch.partition:' · detalle'));
   doc.setTransform(object,{position:[0,0,0],scale:[1,1,1]});
   doc.setBehaviors(object,[Object.assign(schema.defaultBehavior('collision'),{enabled:batch.solid}),...(batch.role==='outdoor-ground'?[schema.defaultBehavior('teleport')]:[]),material(batch.key)]);
   object.userData.practiceFacility={role:batch.role,layoutId:layout.id,finish:batch.key,bakedParts:batch.parts,partition:batch.partition};own(object);triangles+=positions.length/9;
  }
  const environment=Object.assign(schema.studio.defaultEnvironment(roomId),{sky:'color',skyColor:'#b8ccd3',horizonColor:'#d5dedc',groundColor:'#7e8b83',sunColor:'#fff1dc',sunIntensity:.95,ambientIntensity:.72,exposure:1.08,shadows:false,renderQuality:'balanced'});
  doc.setStudio({environments:(doc.studio&&doc.studio.environments||[]).filter(row=>row.roomId!==roomId).concat(environment)});
  const outdoor={version:1,siteBounds:layout.siteBounds,groundBounds:layout.groundBounds,physicalBounds:{...layout.groundBounds,minY:layout.apronY-.24,maxY:9.32},worldBoundary:{...layout.worldBoundary,floorY:layout.apronY},floorY:layout.apronY,
   pavementRects:pavingRects,terrainRects,roads,sourceFloorRects:[[-32,-22,32,22]],ramp:layout.aisles.pedestrianRamp,
   entrances:[{id:'YARD-IN',kind:'vehicle',axis:'x',wallCoordinate:58,center:-29,width:10,height:5},{id:'YARD-OUT',kind:'vehicle',axis:'x',wallCoordinate:58,center:29,width:10,height:5},{id:'STAFF-GATE',kind:'pedestrian',axis:'x',wallCoordinate:58,center:0,width:3.2,height:2.3}],
   objectIds:created.filter(object=>String(object.userData.practiceFacility.role).startsWith('outdoor-')).map(object=>object.userData.editorId),signageObjectId:marks.userData.editorId};
  return{version:1,profile:'CEDI-shared',layoutId:layout.id,sharedLayout:layout,initialView:layout.initialView,bounds,openings,floor,floors,objects:created.map(object=>({objectId:object.userData.editorId,...object.userData.practiceFacility})),physicalParts:parts,outdoor,fixtures,environment,
   adaptations:[{kind:'unified-cedi-u-layout',reason:'CEDI-01 a CEDI-05 comparten la misma instalación, con recepción y despacho frontales, muelles a cota interior y patio deprimido. Las existencias y operaciones se configuran por práctica.',layoutId:layout.id}],
   costs:{bakedGeometryTriangles:triangles,batches:batches.size,parts:[...batches.values()].reduce((sum,batch)=>sum+batch.parts,0),dynamicLights:0,shadowMaps:0},
   limits:'Instalación didáctica genérica. Puertas abiertas y puentes fijos; el flujo, los camiones y el inventario se validan como actores nativos separados. No se calculan lux ni capacidad estructural de la nave.'};
 }finally{boxGeometry.dispose();cylinderGeometry.dispose();}
}
