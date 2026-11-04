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
 ink:{name:'Fondos de señalización de alto contraste',color:'#163a40',preset:'custom',roughness:1},
 white:{name:'Pintura vial blanca',color:'#e7ece5',preset:'custom',roughness:.98},
 glass:{name:'Ventanas de vidrio industrial',color:'#b4d6dc',preset:'glass',opacity:.32,roughness:.12,clearcoat:1,emissiveMode:'custom',emissive:'#9cb7c2',emissiveIntensity:.06},
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
 function frameDoor(axis,at,center,width,height,colour='steel',base=0){
  const point=(along,y)=>axis==='x'?[along,base+y,at]:[at,base+y,along],scale=(length,h,t)=>axis==='x'?[length,h,t]:[t,h,length];
  for(const side of [-1,1])box(colour,point(center+side*(width/2+.08),height/2),scale(.1,height,.25));
  box(colour,point(center,height+.06),scale(width+.26,.12,.25));
 }
 function paintRect(rect,key,y,thickness=.075){const w=rect[2]-rect[0],d=rect[3]-rect[1],x=(rect[0]+rect[2])/2,z=(rect[1]+rect[3])/2;for(const side of [-1,1]){box(key,[x+side*(w-thickness)/2,y,z],[thickness,.008,d]);box(key,[x,y,z+side*(d-thickness)/2],[w-thickness*2,.008,thickness]);}}
 function supportRamp(spec,id){
  const [x0,z0,x1,z1]=spec.rect,y0=spec.fromY,y1=spec.toY,bottom=Math.min(y0,y1)-.24,alongX=spec.axis==='x';
  const corners=alongX?[[x0,y0,z0],[x1,y1,z0],[x1,y1,z1],[x0,y0,z1],[x0,bottom,z0],[x1,bottom,z0],[x1,bottom,z1],[x0,bottom,z1]]:[[x0,y0,z0],[x1,y0,z0],[x1,y1,z1],[x0,y1,z1],[x0,bottom,z0],[x1,bottom,z0],[x1,bottom,z1],[x0,bottom,z1]],faces=[[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]],g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(faces.flatMap(face=>face.flatMap(index=>corners[index])),3));
  geometry('concrete',g,[0,0,0],[1,1,1],[0,0,0],true,'ramp:'+id,'outdoor-ground');g.dispose();
  for(const side of [-1,1]){const cross=alongX?(z0+z1)/2+side*((z1-z0)/2+.15):(x0+x1)/2+side*((x1-x0)/2+.15),a=alongX?[x0,y0+.95,cross]:[cross,y0+.95,z0],b=alongX?[x1,y1+.95,cross]:[cross,y1+.95,z1];beam('trim',a,b,.055,true,'ramp-rail:'+id,'outdoor-envelope');
   const length=alongX?x1-x0:z1-z0,n=Math.ceil(length/2);for(let i=0;i<=n;i++){const t=i/n,coordinate=(alongX?x0:z0)+length*t,y=y0+(y1-y0)*t;const p=alongX?[coordinate,y+.46,cross]:[cross,y+.46,coordinate];cylinder('trim',p,.025,.92);}}
 }
 function window(axis,at,center,width,bottom,top){
  const point=(along,y)=>axis==='x'?[along,y,at]:[at,y,along],scale=(length,h,t)=>axis==='x'?[length,h,t]:[t,h,length];
  box('glass',point(center,(bottom+top)/2),scale(width,top-bottom,.045),true,'glazing:'+axis+':'+at,[0,0,0],'envelope');
  for(const side of [-1,1]){box('trim',point(center+side*(width/2+.035),(bottom+top)/2),scale(.07,top-bottom+.14,.1));box('trim',point(center,(side<0?bottom:top)),scale(width+.14,.07,.1));}
  if(width>3)box('trim',point(center,(bottom+top)/2),scale(.065,top-bottom,.11));
 }
 function hazardBorder(rect){
  const segments=[[rect[0],rect[1],rect[2],rect[1]],[rect[2],rect[1],rect[2],rect[3]],[rect[2],rect[3],rect[0],rect[3]],[rect[0],rect[3],rect[0],rect[1]]];let index=0;
  for(const[x0,z0,x1,z1]of segments){const length=Math.hypot(x1-x0,z1-z0),count=Math.ceil(length/1.1);for(let i=0;i<count;i++){const t=(i+.5)/count;box(index++%2?'white':'red',[x0+(x1-x0)*t,.021,z0+(z1-z0)*t],[x0===x1?.1:length/count,.006,z0===z1?.1:length/count]);}}
 }
 function adminStairs(){
  const stair=layout.annexes.administration.stair,n=stair.stepsPerFlight;
  // A single closed extrusion per flight has no coincident internal riser
  // faces. Adjacent stacked boxes produce false inside-solid parity at treads.
  function flight(x0,x1,reverse){
   const profile=[new THREE.Vector2(8.5,0),new THREE.Vector2(11.3,0)];
   for(let i=n-1;i>=0;i--){const z=8.5+i*stair.tread,h=reverse?stair.rise-i*stair.stepHeight:(i+1)*stair.stepHeight;profile.push(new THREE.Vector2(z+stair.tread,h),new THREE.Vector2(z,h));}
   const faceIndices=THREE.ShapeUtils.triangulateShape(profile,[]),vertices=[],point=(x,i)=>[x,profile[i].y,profile[i].x];
   for(const face of faceIndices){for(const i of face)vertices.push(...point(x0,i));for(const i of face.slice().reverse())vertices.push(...point(x1,i));}
   for(let i=0;i<profile.length;i++){const j=(i+1)%profile.length;vertices.push(...point(x0,i),...point(x1,i),...point(x1,j),...point(x0,i),...point(x1,j),...point(x0,j));}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry('concrete',g,[0,0,0],[1,1,1],[0,0,0],true,'admin-stairs','stairs');g.dispose();
  }
  flight(34,35.3,false);flight(35.7,37,true);
  for(let i=0;i<n;i++){const y1=(i+1)*stair.stepHeight,y2=stair.rise/2+y1,z1=8.5+(i+.5)*stair.tread,z2=11.3-(i+.5)*stair.tread;for(const[x,y,z]of [[34.65,y1,z1],[36.35,y2,z2]])box('yellow',[x,y+.004,z-.12],[1.25,.008,.035]);}
  box('concrete',[35.5,1.59,12],[3,.12,1.4],true,'admin-landing',[0,0,0],'stairs');
  for(const x of [33.9,35.5,37.1]){const first=x<35.5;beam('trim',[x,(first?0:3.3)+1.03,8.45],[x,1.65+1.03,11.4],.045,true,'admin-stair-rail:'+(first?'first':'second'),'stairs');for(let i=0;i<5;i++){const t=i/4,y=(first?0:3.3)+(1.65-(first?0:3.3))*t;cylinder('trim',[x,y+.48,8.5+2.8*t],.022,.96);}}
  for(const x of [34,37])box('trim',[x,2.17,12],[.045,1.04,1.35],true,'admin-stair-landing:sides',[0,0,0],'stairs');box('trim',[35.5,2.17,12.75],[3.1,1.04,.045],true,'admin-stair-landing:back',[0,0,0],'stairs');
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
  const chair=(x,z,y=0,yaw=0)=>{const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),part=(key,p,size)=>{const v=new THREE.Vector3(p[0],p[1],p[2]).applyQuaternion(q).add(new THREE.Vector3(x,y,z));box(key,v.toArray(),size,false,'',[0,yaw,0]);};part('rubber',[0,.46,0],[.48,.12,.48]);part('rubber',[0,.77,-.22],[.48,.58,.095]);for(const dx of [-.18,.18])for(const dz of [-.18,.18])part('steel',[dx,.22,dz],[.035,.44,.035]);};
  const desk=(id,x,z,y=0)=>{box('wood',[x,y+.77,z],[2,.1,.85],true,'support:furniture',[0,0,0],'support-fixture');for(const dx of [-.85,.85])for(const dz of [-.3,.3])box('steel',[x+dx,y+.36,z+dz],[.06,.72,.06]);box('rubber',[x,y+.99,z+.2],[.55,.38,.055]);box('glass',[x,y+.99,z+.165],[.48,.3,.012]);box('rubber',[x,y+.84,z-.15],[.5,.025,.18]);chair(x,z-.85,y);fixtures.push({id,kind:'desk-screen-chair',position:[x,y,z]});};
  desk('control',40.4,3.1);desk('office-a',40.5,3.1,3.3);desk('office-b',40.5,6.2,3.3);desk('office-c',40.5,9.3,3.3);
  box('wood',[40,4.07,15.6],[4.2,.1,1.2],true,'support:furniture',[0,0,0],'support-fixture');for(const x of [38.5,41.5])for(const z of [15.15,16.05])box('steel',[x,3.67,z],[.06,.74,.06]);for(const x of [38.7,40,41.3]){chair(x,14.35,3.3);chair(x,16.85,3.3,Math.PI);}fixtures.push({id:'meeting',kind:'meeting-table-six-chairs',position:[40,3.3,15.6]});
  for(const [x,z,y]of [[43.4,3.8,0],[43.4,18.8,3.3]]){box('lockers',[x,y+1.05,z],[.65,2.1,2.4],true,'support:cabinets',[0,0,0],'support-fixture');for(let dz=-.8;dz<=.8;dz+=.8)box('trim',[x-.34,y+1.1,z+dz],[.025,.18,.035]);}
  for(let n=0;n<6;n++){const z=15.45+n*.68;box('lockers',[33.55,.93,z],[.6,1.86,.6],true,'support:cabinets',[0,0,0],'support-fixture');box('trim',[33.87,1.05,z+.18],[.025,.16,.025]);for(const yy of [.35,1.5])box('rubber',[33.865,yy,z],[.012,.035,.36]);}
  box('wood',[36.2,.48,18.7],[.5,.09,2.1],true,'support:furniture',[0,0,0],'support-fixture');for(const z of [17.9,19.5])box('steel',[36.2,.23,z],[.32,.46,.06]);fixtures.push({id:'lockers',kind:'six-lockers-and-bench',position:[33.55,0,17.4]});
  for(const z of [14,18]){cylinder('porcelain',[43.05,.35,z],.27,.45,[0,0,0],true,'support:sanitary','support-fixture');box('porcelain',[43.05,.58,z+.3],[.5,.52,.2],true,'support:sanitary',[0,0,0],'support-fixture');cylinder('rubber',[43.05,.59,z-.05],.23,.045);}
  box('porcelain',[40.9,.8,12.5],[1.2,.2,.48],true,'support:sanitary',[0,0,0],'support-fixture');cylinder('trim',[40.9,1.015,12.6],.025,.24);box('glass',[40.9,1.55,12.18],[1.05,.8,.025]);fixtures.push({id:'restrooms',kind:'two-toilets-basin-mirror',position:[43.05,0,16]});
  box('steel',[-38.5,.85,-29.5],[8,.12,.85],true,'support:maintenance',[0,0,0],'support-fixture');for(const x of [-41.8,-35.2])box('steel',[x,.4,-29.5],[.07,.8,.65]);box('steel',[-38.5,1.65,-30.65],[7.5,1.15,.08]);box('lockers',[-34.2,.95,-20.1],[1.5,1.9,.65],true,'support:cabinets',[0,0,0],'support-fixture');
  for(let n=0;n<7;n++){box('trim',[-41.2+n*.85,.98,-29.5],[.25,.1,.16]);cylinder('rubber',[-41.1+n*.85,1.08,-29.5],.07,.15,[0,0,Math.PI/2]);box('trim',[-41+n*.8,1.8,-30.57],[.05,.35,.035]);}fixtures.push({id:'maintenance',kind:'workbench-tool-nests-service-cabinet',position:[-38.5,0,-29.5]});
  // The equipment composition owns the native empty-packaging rack and its supported totes.
  return fixtures;
 }

 try{
  const floor=slab('CEDI compartido · piso interior de hormigón 64 × 60 m',[bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ],0);
  const roads=[[-34,58,-24,82],[24,58,34,82]],pavingRects=surround(layout.siteBounds,bounds).concat(roads),terrainRects=roads.reduce((rects,cut)=>rects.flatMap(rect=>subtract(rect,cut)),surround(layout.groundBounds,layout.siteBounds));
  for(const rect of pavingRects)groundRect(rect,'paving','outdoor:paving');for(const rect of terrainRects)groundRect(rect,'terrain','outdoor:terrain');supportRamp(layout.aisles.pedestrianRamp,'staff');
  const admin=layout.annexes.administration,service=layout.annexes.maintenance;
  slab('Administración · planta baja',admin.rect,0,'concrete','annex-ground');slab('Mantenimiento · piso del taller',service.rect,0,'concrete','annex-ground');
  for(const rect of [admin.connectorRect,service.connectorRect])box('concrete',[(rect[0]+rect[2])/2,-.12,(rect[1]+rect[3])/2],[rect[2]-rect[0],.24,rect[3]-rect[1]],true,'connector-floors',[0,0,0],'outdoor-ground');
  for(const rect of subtract(admin.rect,admin.stair.voidRect))box('concrete',[(rect[0]+rect[2])/2,admin.upperY-.12,(rect[1]+rect[3])/2],[rect[2]-rect[0],.24,rect[3]-rect[1]],true,'admin-upper-floor',[0,0,0],'mezzanine-floor');
  supportRamp(admin.ramp,'administration');supportRamp(service.ramp,'maintenance');adminStairs();
  const frontHoles=layout.docks.map(d=>({center:d.center,width:d.width,bottom:0,height:d.height})).concat([{center:0,width:2.2,height:2.6},{center:-5.5,width:4.4,bottom:1.1,height:2.45},{center:5.5,width:3.5,bottom:2.35,height:3.05}]);
  const adminWindows=[{center:5,width:4.4,bottom:3.9,height:5.9}],adminPortal={center:5,width:2.4,height:2.6},maintenancePortal={center:-25,width:2.4,height:2.8};
  wall('x',22,-32,32,bounds.height,frontHoles,layout.apronY);wall('x',bounds.minZ,-32,32,bounds.height,[],layout.apronY);wall('z',-32,bounds.minZ,22,bounds.height,[maintenancePortal],layout.apronY);wall('z',32,bounds.minZ,22,bounds.height,[adminPortal,...adminWindows],layout.apronY);
  for(const z of [bounds.minZ,22]){box('concrete',[0,-.58,z+(z===22?.101:-.101)],[64,1.14,.018]);for(let x=-30;x<32;x+=3){if(z===22&&frontHoles.some(h=>x>h.center-h.width/2&&x<h.center+h.width/2))continue;box('trim',[x,bounds.height/2,z+(z===22?.107:-.107)],[.026,bounds.height-.8,.027]);}}
  for(const x of [-32,32]){box('concrete',[x+Math.sign(x)*.101,-.58,-8],[.018,1.14,60]);for(let z=-35;z<22;z+=3){if(x===-32&&Math.abs(z+25)<1.5||x===32&&Math.abs(z-5)<1.5)continue;box('trim',[x+Math.sign(x)*.107,bounds.height/2,z],[.027,bounds.height-.8,.026]);}}
  window('x',22,-5.5,4.4,1.1,2.45);window('x',22,5.5,3.5,2.35,3.05);window('z',32,5,4.4,3.9,5.9);frameDoor('x',22,0,2.2,2.6,'green');frameDoor('z',32,5,2.4,2.6,'green');frameDoor('z',-32,-25,2.4,2.8,'green');
  for(const dock of layout.docks){
   openings.push({...dock,purpose:dock.purpose==='receiving'?'Recepción':'Despacho',normal:[0,0,1]});frameDoor('x',22,dock.center,dock.width,dock.height);
   for(const side of [-1,1]){box('rubber',[dock.center+side*2.28,2.4,22.12],[.3,4.8,.34]);box('rubber',[dock.center+side*1.75,-.28,22.28],[.3,.85,.3]);box('yellow',[dock.center+side*2.48,.6,21.65],[.17,1.2,.17]);}
   box('rubber',[dock.center,4.98,22.12],[4.86,.28,.34]);box('roof',[dock.center,5.3,22],[4.65,.42,.5]);
   // Flush, physically supported transfer plates keep both deck heights zero.
   box('trim',[dock.center,-.045,21.65],[2.9,.09,1.7],true,'dock-bridges',[0,0,0],'dock-bridge');
   for(const x of [-.85,.85]){cylinder('trim',[dock.center+x,-.28,21.8],.055,.55,[Math.PI/4,0,0]);box('steel',[dock.center+x,-.5,21.9],[.12,.08,.7]);}
   for(const side of [-1,1])box('yellow',[dock.center+side*1.85,layout.apronY+.1,28.6],[.12,.2,5.6],true,'outdoor:dock-guides:'+dock.id,[0,0,0],'outdoor-envelope');paintRect([dock.center-2.45,23.1,dock.center+2.45,36.4],'yellow',layout.apronY+.012);
  }
  openings.push({id:'STAFF-ENTRY',axis:'x',wallCoordinate:22,center:0,width:2.2,height:2.6,purpose:'Acceso peatonal',normal:[0,0,1]},
   {id:'ADMIN-WAREHOUSE',axis:'z',wallCoordinate:32,center:5,width:2.4,height:2.6,purpose:'Administración desde nave',normal:[1,0,0]},
   {id:'ADMIN-EXTERIOR',axis:'x',wallCoordinate:20,center:38.4,width:2.4,height:2.6,purpose:'Entrada exterior administración',normal:[0,0,1]},
   {id:'MAINTENANCE-WAREHOUSE',axis:'z',wallCoordinate:-32,center:-25,width:2.4,height:2.8,purpose:'Taller desde nave',normal:[-1,0,0]},
   {id:'MAINTENANCE-EXTERIOR',axis:'z',wallCoordinate:-44,center:-25,width:2.6,height:2.8,purpose:'Entrada exterior taller',normal:[-1,0,0]});
  // Individual thin wall planes retain empty walking volumes. Upper floors,
  // glazing and roofs remain separate editable/cutaway objects.
  const upperWin={center:38.5,width:8,bottom:4,height:5.9};
  wall('x',1,33,44,6.6,[{center:38.5,width:8,bottom:1.1,height:2.5},upperWin],layout.apronY);
  wall('x',20,33,44,6.6,[{center:38.4,width:2.4,height:2.6},{center:35.5,width:3,bottom:1.1,height:2.5},upperWin],layout.apronY);
  wall('z',33,1,20,6.6,[adminPortal,{center:5,width:4.4,bottom:3.9,height:5.9}],layout.apronY);
  const sideWindows=[{center:4.5,width:4,bottom:1.1,height:2.5},{center:10,width:3.5,bottom:1.1,height:2.5},{center:16,width:4,bottom:2,height:2.7},...[4.5,10,16].map(center=>({center,width:4,bottom:4,height:5.9}))];wall('z',44,1,20,6.6,sideWindows,layout.apronY);
  window('x',1,38.5,8,1.1,2.5);window('x',1,38.5,8,4,5.9);window('x',20,35.5,3,1.1,2.5);window('x',20,38.5,8,4,5.9);window('z',33,5,4.4,3.9,5.9);for(const win of sideWindows)window('z',44,win.center,win.width,win.bottom,win.height);
  wall('z',38.5,1,8,3.2,[{center:5,width:1.5,height:2.25}]);wall('x',8,38.5,44,3.2);
  wall('x',15,33,37.5,3.2,[{center:35.8,width:1.3,height:2.25}]);wall('z',37.5,15,20,3.2,[{center:17,width:1.3,height:2.25}]);wall('z',39.2,12,20,3.2,[{center:14,width:1.3,height:2.25}]);wall('x',12,39.2,44,3.2);wall('x',16,40.3,44,2.2);
  for(const door of [admin.entrance,{axis:'z',coordinate:33,center:5,width:2.4,height:2.6},...layout.rooms.filter(room=>room.id!=='office'&&room.id!=='maintenance').map(room=>room.door)])frameDoor(door.axis,door.coordinate,door.center,door.width,door.height);
  box('roof',[38.5,6.66,10.5],[11.4,.12,19.4],true,'admin-roof',[0,0,0],'roof');box('roof',[32.5,2.85,5],[1.4,.12,2.8],true,'connector-roofs',[0,0,0],'ceiling');
  wall('x',-31,-44,-33,3.7,[{center:-38.5,width:7,bottom:1.5,height:2.9}],layout.apronY);wall('x',-19,-44,-33,3.7,[],layout.apronY);wall('z',-33,-31,-19,3.7,[maintenancePortal],layout.apronY);wall('z',-44,-31,-19,3.7,[{center:-25,width:2.6,height:2.8},{center:-29,width:2,bottom:1.3,height:2.8},{center:-21,width:2,bottom:1.3,height:2.8}],layout.apronY);
  window('x',-31,-38.5,7,1.5,2.9);for(const z of [-29,-21])window('z',-44,z,2,1.3,2.8);frameDoor('z',-33,-25,2.4,2.8);frameDoor('z',-44,-25,2.6,2.8);box('roof',[-38.5,3.76,-25],[11.4,.12,12.4],true,'maintenance-roof',[0,0,0],'roof');box('roof',[-32.5,3.02,-25],[1.4,.12,2.8],true,'connector-roofs',[0,0,0],'ceiling');
  // Plinths, reveals and floor bands explain the raised annex foundations.
  for(const [x0,z0,x1,z1]of [admin.rect,service.rect]){for(const x of [x0,x1])box('concrete',[x,-.58,(z0+z1)/2],[.2,1.14,z1-z0]);for(const z of [z0,z1])box('concrete',[(x0+x1)/2,-.58,z],[x1-x0,1.14,.2]);}
  for(const z of [1,20])box('steel',[38.5,3.3,z],[11.25,.15,.2]);for(const x of [33,44])box('steel',[x,3.3,10.5],[.2,.15,19.25]);
  const fixtures=furniture();fixtures.push({id:'admin-stairs',kind:'two-flight-stair-with-landing',position:admin.stair.groundStart.slice(),upperEnd:admin.stair.upperEnd.slice(),steps:20});
  for(const [x,z,y]of [[40.5,4.5,3.17],[36,14,3.17],[41.5,16,3.17],[40.5,4.5,6.47],[40.5,10,6.47],[40,16,6.47],[-38.5,-25,3.57]])box('light',[x,y,z],[1.5,.025,.5]);
  for(const z of [-34,-22,-10,2,14]){
   for(const x of [-31.7,31.7]){box('steel',[x,bounds.height/2,z],[.24,bounds.height,.34],true,'structure:'+Math.sign(x),[0,0,0],'envelope');box('trim',[x,.06,z],[.6,.12,.65]);box('yellow',[x,.58,z],[.48,1.1,.5]);for(const dx of [-.2,.2])for(const dz of [-.22,.22])cylinder('trim',[x+dx,.15,z+dz],.035,.06);}
   box('steel',[0,9.55,z],[63.5,.17,.3]);box('steel',[0,10.02,z],[63.5,.1,.35]);for(let x=-31.5;x<31;x+=5.25){beam('steel',[x,9.5,z],[x+5.25,9.98,z]);beam('steel',[x,9.98,z],[x+5.25,9.5,z]);}
  }
  box('roof',[0,10.26,-8],[64.4,.12,60.4],true,'main-roof',[0,0,0],'roof');for(let x=-31;x<=31;x+=2)box('trim',[x,10.18,-8],[.024,.035,60]);
  for(const x of [-21,0,21])for(const z of [-31,-21,-11,-1,9,19]){box('steel',[x,9.05,z],[2.35,.12,.55]);box('light',[x,8.978,z],[2.15,.025,.44]);for(const side of [-1,1])cylinder('trim',[x+side*.85,9.6,z],.012,1);}
  for(const x of [-24,24]){box('roof',[x,9.4,-8],[.38,.04,58]);for(const side of [-1,1])box('roof',[x+side*.2,9.47,-8],[.03,.15,58]);for(let z=-36;z<=20;z+=2)box('trim',[x,9.45,z],[.38,.025,.04]);}
  for(const [x,z]of [[-30.8,20],[30.8,20],[-30.8,-36],[30.8,-36],[43,10],[-43,-20]]){cylinder('red',[x,.95,z],.11,.58);cylinder('trim',[x,1.28,z],.035,.06);box('rubber',[x,1.35,z],[.2,.045,.075]);cylinder('rubber',[x+.13,1,z],.017,.45);box('steel',[x,.63,z],[.25,.04,.2]);}
  const site=layout.siteBounds;fence('z',site.minX,site.minZ,site.maxZ,[{center:-25,width:4.4}]);fence('z',site.maxX,site.minZ,site.maxZ);fence('x',site.minZ,site.minX,site.maxX);fence('x',site.maxZ,site.minX,site.maxX,[{center:-29,width:10},{center:29,width:10},{center:0,width:3.2}]);
  const boundary=layout.worldBoundary;
  for(const x of [boundary.minX,boundary.maxX])box('concrete',[x,layout.apronY+1.2,(boundary.minZ+boundary.maxZ)/2],[boundary.thickness,2.4,boundary.maxZ-boundary.minZ],true,'outdoor:world:x:'+x,[0,0,0],'outdoor-envelope');
  for(const z of [boundary.minZ,boundary.maxZ])box('concrete',[(boundary.minX+boundary.maxX)/2,layout.apronY+1.2,z],[boundary.maxX-boundary.minX,2.4,boundary.thickness],true,'outdoor:world:z:'+z,[0,0,0],'outdoor-envelope');
  for(let z=26;z<51;z+=5){paintRect([-45,z,-39,z+2.7],'white',layout.apronY+.012);box('rubber',[-44.6,layout.apronY+.09,z+1.35],[.15,.18,2]);}
  for(const x of [-29,29])for(let z=43;z<78;z+=4)box('white',[x,layout.apronY+.012,z],[.14,.008,1.8]);
  for(const side of [-1,1])box('white',[side*1.03,layout.apronY+.012,47],[.055,.008,22]);
  const text=['CEDI · FLUJO EN U','REC-01','REC-02','DES-01','DES-02','R01 · ALMACENAMIENTO','P01 · PICKING','E01 · EMPAQUE','Q01 · CUARENTENA','B01 · EMBALAJES VACÍOS','ADMINISTRACIÓN','SERVICIOS HIGIÉNICOS','VESTUARIO','M01 · MANTENIMIENTO','SALIDA','RECEPCIÓN','DESPACHO','X01 · CROSS-DOCKING','A01 · AS/RS AUTOMÁTICO','R02 · RESERVA ABC','ACCESO A LA NAVE','ESCALERA','PEATONES','P02 · PICKING DE PISO'];
  const labels=[[-22,20.4,0,3,.5,9],[-14,20.4,0,3,.5,10],[14,20.4,0,3,.5,11],[22,20.4,0,3,.5,12],[-1,-19.2,0,7.8,.8,13],[13,4.5,0,6.5,.65,14],[16,11.5,0,6.5,.65,15],[-4.5,6.3,0,5.5,.65,16],[-4.5,11.8,0,5.5,.65,17],[0,21,0,2,.45,22],[-21,18.9,0,7.8,.7,23],[19,18.9,0,7.8,.7,24],[0,16,0,7.8,.85,25],[-23,-21.2,0,7.8,.85,26],[5,-21.2,0,7.8,.85,27],[35.5,6.6,0,3.5,.5,18],[41.5,11.3,0,4.2,.5,19],[36,14.2,0,3.8,.5,20],[-38.5,-27.5,0,7.2,.7,21],[13,-10.25,0,7.8,.65,31]];
  for(const[x,z,yaw,width,depth]of labels)box('ink',[x,.026,z],[width+.25,.004,depth+.12],false,'',[0,yaw,0]);
  for(const key of ['asrs','quarantine','crossDock'])hazardBorder(layout.zones[key].rect);
  const marks=doc.addIndustrialFloorPresentation(roomId,{type:'industrialFloor',version:1,bounds:[-32,-38,32,22],floorY:.008,texts:text,
   walkways:layout.aisles.pedestrianRects,zones:Object.entries(layout.zones).filter(([key,zone])=>zone.kind==='operations'&&!['asrs','quarantine','crossDock'].includes(key)).map(([,zone])=>zone.rect),bays:[],crossings:layout.aisles.crossings,
   arrows:[[-12,9,Math.PI],[-12,-2,Math.PI],[-4,-7,Math.PI/2],[10,-7,Math.PI/2],[27,2,0],[27,13,0],[27,-29,0],[-15,-21,Math.PI/2]],labels,
   signs:[[-28.7,9,0,1,23],[24,13,Math.PI,1,24],[31,5,Math.PI/2,0,18],[38.3,14,Math.PI/2,0,19],[35,14.6,0,0,20],[-31.2,-25,Math.PI/2,1,21],[-30.5,19,0,1,6],[30.5,19,0,1,6],[-15.1,-21,0,1,26],[3,15,0,1,25]]});
  doc.setProperty(marks,'name','CEDI compartido · códigos y nombres grandes de sectores, cruces y rutas');doc.setBehaviors(marks,[Object.assign(schema.defaultBehavior('collision'),{enabled:false})]);marks.userData.practiceFacility={role:'signage',layoutId:layout.id};own(marks);
  const officeLabels=[[40,17.8,0,6.8,.65,8],[40,10.8,0,6.8,.65,9],[36.35,7.6,0,2.4,.45,10]];for(const[x,z,yaw,width,depth]of officeLabels)box('ink',[x,3.326,z],[width+.25,.004,depth+.12]);
  const officeMarks=doc.addIndustrialFloorPresentation(roomId,{type:'industrialFloor',version:1,bounds:admin.rect,floorY:3.308,texts:['SALA DE REUNIONES','OFICINAS · PLANTA ALTA','ESCALERA'],labels:officeLabels});doc.setProperty(officeMarks,'name','Administración · orientación de planta alta');doc.setBehaviors(officeMarks,[Object.assign(schema.defaultBehavior('collision'),{enabled:false})]);officeMarks.userData.practiceFacility={role:'signage',layoutId:layout.id};own(officeMarks);
  let triangles=0;
  for(const batch of batches.values()){
   const positions=batch.positions,descriptor={type:'cad',recipe:{steps:[{id:'s1',op:'primitive.mesh',params:{positions},inputs:[]}],output:'s1'},mesh:{positions},color:FINISHES[batch.key].color,smoothingAngle:0},object=doc.addCAD(roomId,descriptor);
   doc.setProperty(object,'name','CEDI compartido · '+FINISHES[batch.key].name+(batch.solid?' · '+batch.partition:' · detalle'));
   doc.setTransform(object,{position:[0,0,0],scale:[1,1,1]});
   doc.setBehaviors(object,[Object.assign(schema.defaultBehavior('collision'),{enabled:batch.solid}),...(['outdoor-ground','mezzanine-floor'].includes(batch.role)?[schema.defaultBehavior('teleport')]:[]),material(batch.key)]);
   object.userData.practiceFacility={role:batch.role,layoutId:layout.id,finish:batch.key,bakedParts:batch.parts,partition:batch.partition};own(object);triangles+=positions.length/9;
  }
  const environment=Object.assign(schema.studio.defaultEnvironment(roomId),{sky:'color',skyColor:'#b8ccd3',horizonColor:'#d5dedc',groundColor:'#7e8b83',sunColor:'#fff1dc',sunIntensity:.95,ambientIntensity:.72,exposure:1.08,shadows:false,renderQuality:'balanced'});
  doc.setStudio({environments:(doc.studio&&doc.studio.environments||[]).filter(row=>row.roomId!==roomId).concat(environment)});
  const outdoor={version:1,siteBounds:layout.siteBounds,groundBounds:layout.groundBounds,physicalBounds:{...layout.groundBounds,minY:layout.apronY-.24,maxY:10.32},worldBoundary:{...layout.worldBoundary,floorY:layout.apronY},floorY:layout.apronY,
   pavementRects:pavingRects,terrainRects,roads,sourceFloorRects:[[bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ]],ramp:layout.aisles.pedestrianRamp,annexes:layout.annexes,
   entrances:[{id:'YARD-IN',kind:'vehicle',axis:'x',wallCoordinate:58,center:-29,width:10,height:5},{id:'YARD-OUT',kind:'vehicle',axis:'x',wallCoordinate:58,center:29,width:10,height:5},{id:'STAFF-GATE',kind:'pedestrian',axis:'x',wallCoordinate:58,center:0,width:3.2,height:2.3},{id:'MAINTENANCE-GATE',kind:'pedestrian',axis:'z',wallCoordinate:-48,center:-25,width:4.4,height:2.3,floorY:-.46}],
   objectIds:created.filter(object=>String(object.userData.practiceFacility.role).startsWith('outdoor-')).map(object=>object.userData.editorId),signageObjectId:marks.userData.editorId};
  return{version:1,profile:'CEDI-shared',layoutId:layout.id,sharedLayout:layout,initialView:layout.initialView,bounds,openings,floor,floors,objects:created.map(object=>({objectId:object.userData.editorId,...object.userData.practiceFacility})),physicalParts:parts,outdoor,fixtures,environment,
   adaptations:[{kind:'unified-cedi-u-layout',reason:'CEDI-01 a CEDI-05 comparten la misma instalación, con recepción y despacho frontales, muelles a cota interior y patio deprimido. Las existencias y operaciones se configuran por práctica.',layoutId:layout.id}],
   costs:{bakedGeometryTriangles:triangles,batches:batches.size,parts:[...batches.values()].reduce((sum,batch)=>sum+batch.parts,0),dynamicLights:0,shadowMaps:0},
   limits:'Instalación didáctica genérica. Puertas abiertas y puentes fijos; el flujo, los camiones y el inventario se validan como actores nativos separados. No se calculan lux ni capacidad estructural de la nave.'};
 }finally{boxGeometry.dispose();cylinderGeometry.dispose();}
}
