import * as THREE from 'three';
import schema from '../../../contracts/behaviors.js';

// Architecture is authored as a small number of ordinary, persisted CAD meshes,
// grouped by finish and collision role. The CPU/editor/Quest render the same
// walls, openings and profiles; no temporary decorative replacement is added.
const PROFILES = {
  'CEDI-01': {title:'RECEPCIÓN Y CONTROL',zone:'INSPECCIÓN',left:true},
  'CEDI-02': {title:'ALMACÉN E INVENTARIO',zone:'REPOSICIÓN'},
  'CEDI-03': {title:'PREPARACIÓN DE PEDIDOS',zone:'CONSOLIDACIÓN'},
  'CEDI-04': {title:'EMPAQUE Y PALETIZADO',zone:'EMPAQUE'},
  'CEDI-05': {title:'EXPEDICIÓN Y DESPACHO',zone:'CONTROL DE CARGA',right:true},
  'SF-01': {title:'RECEPCIÓN DE MATERIAS PRIMAS',zone:'CONTROL DE LOTE',left:true},
  'SF-02': {title:'ABASTECIMIENTO DE LÍNEA',zone:'KITTING'},
  'SF-03': {title:'CELDA DE MANUFACTURA',zone:'CONTROL DE PROCESO'},
  'SF-04': {title:'ENSAMBLE Y CALIDAD',zone:'PRUEBAS Y LIBERACIÓN'},
  'SF-05': {title:'TERMINADOS Y DESPACHO',zone:'DESPACHO',right:true}
};
const FINISHES = {
  wall:{name:'Paneles de cerramiento',color:'#c3c9c6',preset:'paintedMetal',roughness:.79,wear:.075,wearType:'dirt',repeatX:.16,repeatY:.16},
  plinth:{name:'Zócalos de hormigón',color:'#8b928d',preset:'concrete',roughness:.94,wear:.13,wearType:'dirt',repeatX:.22,repeatY:.22},
  steel:{name:'Estructura y perfiles',color:'#46565b',preset:'paintedMetal',roughness:.62,metalness:.05,wear:.09,wearType:'chips'},
  roof:{name:'Cubierta y bandejas',color:'#99a6a9',preset:'steel',roughness:.73,metalness:.35,wear:.05,repeatX:.2,repeatY:.2},
  trim:{name:'Herrajes galvanizados',color:'#b2bec0',preset:'steel',roughness:.54,metalness:.75,wear:.06},
  yellow:{name:'Protecciones de impacto',color:'#d9ae32',preset:'paintedMetal',roughness:.77,wear:.16,wearType:'chips'},
  dark:{name:'Sellos y juntas',color:'#354144',preset:'rubber',roughness:.94,wear:.09},
  glass:{name:'Vidrio alto difusor',color:'#a8c2ca',preset:'custom',roughness:.48,emissiveMode:'custom',emissive:'#a3bfcc',emissiveIntensity:.15},
  light:{name:'Difusores LED',color:'#f8f4df',preset:'custom',roughness:.72,emissiveMode:'custom',emissive:'#fff4dc',emissiveIntensity:1.15},
  red:{name:'Protección contra incendios',color:'#b93e37',preset:'paintedMetal',roughness:.67,wear:.12,wearType:'chips'},
  green:{name:'Identificación de salida',color:'#19846a',preset:'paintedMetal',roughness:.85},
  paving:{name:'Patio y calle de hormigón vial',color:'#646b68',preset:'concrete',roughness:.98,wear:.17,wearType:'dirt',repeatX:.13,repeatY:.13},
  terrain:{name:'Terreno compactado del parque industrial',color:'#77806c',preset:'concrete',roughness:1,wear:.13,wearType:'dirt',repeatX:.09,repeatY:.09}
};
const round = n => Math.round(n * 1000000) / 1000000;
const finish = (key, values={}) => Object.assign(schema.defaultBehavior('surfaceMaterial'),{colorMapMode:'preserve',metalness:0,roughness:.8,clearcoat:0,seed:311},FINISHES[key],values);

/** Source floors and actor coordinates remain unchanged. A narrow physical
 * perimeter apron accommodates the building envelope outside operating lanes.
 * The receiving continuation is retained at exactly its existing coordinates. */
export function buildPracticeFacility(doc,roomId,plan,objects) {
  if (!PROFILES[plan.id]) throw Error('Instalación de práctica no reconocida.');
  const profile=PROFILES[plan.id],width=plan.interiorArea.width,depth=plan.interiorArea.depth;
  const perimeter=1.8,height=7.2,continuation=plan.id==='CEDI-01'?10:0;
  const bounds={minX:-width/2-perimeter,maxX:width/2+continuation+perimeter,minZ:-depth/2-perimeter,maxZ:depth/2+perimeter,height};
  const created=[],batches=new Map(),parts=[],floors=[],openings=[];
  const boxGeometry=new THREE.BoxBufferGeometry(1,1,1).toNonIndexed();
  const cylinderGeometry=new THREE.CylinderBufferGeometry(1,1,1,10,1).toNonIndexed();
  const vertex=new THREE.Vector3(),matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion();
  function mesh(key,geometry,position,scale,rotation,collision=false,collisionPartition='') {
    // A closed CAD containing every exterior wall spans the empty room. Its
    // touching cuboids also introduce coincident ray crossings in insideSolid.
    // Keep each physical wall in its own thin spatial partition; render and
    // collision still use the exact same persisted geometry.
    if(collision&&!collisionPartition&&['steel','trim','yellow'].includes(key))collisionPartition=Math.abs(position[0]-bounds.minX)<Math.abs(position[0]-bounds.maxX)?'left-frame':'right-frame';
    const batchKey=key+':'+(collision?'solid:'+collisionPartition:'detail');
    if(!batches.has(batchKey)) batches.set(batchKey,{key,collision,positions:[],parts:0,outdoor:collisionPartition.startsWith('outdoor:')||['paving','terrain'].includes(key),partition:collisionPartition});
    const batch=batches.get(batchKey);quaternion.setFromEuler(new THREE.Euler(...(rotation||[0,0,0])));
    matrix.compose(new THREE.Vector3(...position),quaternion,new THREE.Vector3(...scale));
    const array=geometry.attributes.position.array;
    for(let n=0;n<array.length;n+=3){vertex.set(array[n],array[n+1],array[n+2]).applyMatrix4(matrix);batch.positions.push(round(vertex.x),round(vertex.y),round(vertex.z));}
    batch.parts++;
  }
  function box(key,position,scale,collision=false,rotation,collisionPartition) {
    if(scale.some(n=>!Number.isFinite(n)||n<=0))throw Error('Perfil de instalación inválido.');
    mesh(key,boxGeometry,position,scale,rotation,collision,collisionPartition);
    if(collision)parts.push({finish:key,position:position.slice(),scale:scale.slice(),rotation:rotation||[0,0,0]});
  }
  function cylinder(key,position,radius,length,rotation,collision=false){mesh(key,cylinderGeometry,position,[radius,length,radius],rotation,collision);}
  function beam(a,b,thickness=.065){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),mid=start.clone().add(end).multiplyScalar(.5),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),end.sub(start).normalize());const e=new THREE.Euler().setFromQuaternion(q);box('steel',mid.toArray(),[thickness,start.distanceTo(new THREE.Vector3(...b)),thickness],false,e.toArray().slice(0,3));}
  function slab(name,x,z,w,d,source=false) {
    const o=doc.addPrimitive(roomId,'box','#777c76');doc.setProperty(o,'name',name);doc.setTransform(o,{position:[x,-.12,z],scale:[w,.24,d]});
    doc.setBehaviors(o,[schema.defaultBehavior('collision'),schema.defaultBehavior('teleport'),finish('plinth',{name:'Hormigón',preset:'concrete',color:'#777c76',roughness:.96,wear:.11,wearType:'dirt',repeatX:w/4,repeatY:d/4})]);
    o.userData.practiceFacility={role:source?'source-floor':'apron',practiceId:plan.id};objects.push(o);created.push(o);floors.push(o);return o;
  }
  function wall(axis,constant,min,max,holes=[],windows=false) {
    // Break real solids at openings; a painted rectangle is never a door.
    const cut=[min,max].concat(holes.flatMap(h=>[h.center-h.width/2,h.center+h.width/2])).filter(n=>n>=min&&n<=max).sort((a,b)=>a-b),inside=constant===(axis==='x'?bounds.minZ:bounds.minX)?1:-1;
    function segment(from,to,bottom,top,key) {
      if(to-from<.001||top-bottom<.001)return;
      box(key,axis==='x'?[(from+to)/2,(bottom+top)/2,constant]:[constant,(bottom+top)/2,(from+to)/2],axis==='x'?[to-from,top-bottom,.18]:[.18,top-bottom,to-from],true,undefined,axis+':'+constant);
    }
    for(let i=1;i<cut.length;i++){
      const a=cut[i-1],b=cut[i],mid=(a+b)/2,hole=holes.find(h=>mid>h.center-h.width/2+.001&&mid<h.center+h.width/2-.001),bottom=hole?hole.height:0;
      if(bottom<1.1)segment(a,b,bottom,1.1,'plinth');
      segment(a,b,Math.max(1.1,bottom),5.15,'wall');
      segment(a,b,5.15,6.05,windows?'glass':'wall');segment(a,b,6.05,height,'wall');
      if(windows)for(const at of [a,b])box('trim',axis==='x'?[at,5.6,constant+inside*.11]:[constant+inside*.11,5.6,at],axis==='x'?[.055,.98,.06]:[.06,.98,.055]);
    }
    // Raised narrow seams and top/bottom flashings have a physical offset.
    for(let at=min+2;at<max-.5;at+=2){if(holes.some(h=>at>h.center-h.width/2&&at<h.center+h.width/2))continue;box('trim',axis==='x'?[at,3.1,constant+inside*.105]:[constant+inside*.105,3.1,at],axis==='x'?[.026,3.9,.025]:[.025,3.9,.026]);}
    for(const y of [1.12,5.14,6.07])for(let i=1;i<cut.length;i++){const a=cut[i-1],b=cut[i],mid=(a+b)/2;if(holes.some(h=>y<h.height&&mid>h.center-h.width/2&&mid<h.center+h.width/2))continue;box('trim',axis==='x'?[(a+b)/2,y,constant+inside*.105]:[constant+inside*.105,y,(a+b)/2],axis==='x'?[b-a,.055,.035]:[.035,.055,b-a]);}
  }
  function gateway(side,center,clearWidth,clearHeight,label) {
    const x=side==='left'?bounds.minX:bounds.maxX,sign=side==='left'?1:-1;
    openings.push({id:plan.id+'-'+side+'-goods',side,axis:'z',wallCoordinate:x,center,width:clearWidth,height:clearHeight,purpose:label});
    for(const edge of [-1,1]){
      const z=center+edge*(clearWidth/2+.12);box('steel',[x,clearHeight/2,z],[.32,clearHeight,.24],true);
      box('yellow',[x+sign*.32,.65,z],[.24,1.3,.24],true);
      box('dark',[x+sign*.025,2.2,z-sign*.01],[.36,3.6,.13]);
    }
    box('steel',[x,clearHeight+.15,center],[.34,.3,clearWidth+.46],true);
    // Rolled shutter is physically above the opening, not across the route.
    box('roof',[x,clearHeight+.49,center],[.48,.36,clearWidth+.1]);
    for(let y=clearHeight+.35;y<clearHeight+.65;y+=.09)box('trim',[x+sign*.25,y,center],[.04,.02,clearWidth]);
    for(const edge of [-1,1])cylinder('trim',[x+sign*.32,1.32,center+edge*(clearWidth/2+.12)],.055,.035);
  }
  function exterior() {
    // The authored interior and the tested truck pads remain separate, exact
    // source slabs. Subtract their rectangles instead of hiding the cliff with
    // a second coplanar floor, which would shimmer in both eyes of the headset.
    const site={minX:bounds.minX-22,maxX:bounds.maxX+22,minZ:bounds.minZ-22,maxZ:bounds.maxZ+22};
    const ground={minX:-94,maxX:94,minZ:-94,maxZ:94};
    const gateX=profile.right?width/2+7:profile.left?-width/2-7:bounds.minX-9;
    const road=[gateX-5,site.maxZ,gateX+5,ground.maxZ],siteRect=[site.minX,site.minZ,site.maxX,site.maxZ];
    const sourceRects=floors.map(f=>[f.position.x-f.scale.x/2,f.position.z-f.scale.z/2,f.position.x+f.scale.x/2,f.position.z+f.scale.z/2]);
    function subtract(rect,cut) {
      const [x0,z0,x1,z1]=rect,a=Math.max(x0,cut[0]),b=Math.max(z0,cut[1]),c=Math.min(x1,cut[2]),d=Math.min(z1,cut[3]);
      if(c<=a||d<=b)return [rect];
      return [[x0,z0,a,z1],[c,z0,x1,z1],[a,z0,c,b],[a,d,c,z1]].filter(r=>r[2]-r[0]>.00001&&r[3]-r[1]>.00001);
    }
    const cutAll=(rects,cuts)=>cuts.reduce((result,cut)=>result.flatMap(rect=>subtract(rect,cut)),rects);
    const pavingRects=cutAll([siteRect],sourceRects).concat([road]);
    const terrainRects=cutAll([[ground.minX,ground.minZ,ground.maxX,ground.maxZ]],[siteRect,road]);
    for(const [key,rects] of [['paving',pavingRects],['terrain',terrainRects]])for(const r of rects)box(key,[(r[0]+r[2])/2,-.12,(r[1]+r[3])/2],[r[2]-r[0],.24,r[3]-r[1]],true,undefined,'outdoor:'+key);
    const boundary=[];
    function fence(axis,at,min,max,side,holes=[]) {
      const segments=cutAll([[min,0,max,1]],holes.map(h=>[h.center-h.width/2,-1,h.center+h.width/2,2])).map(r=>[r[0],r[2]]);
      const point=(along,y,offset=0)=>axis==='x'?[along,y,at+offset]:[at+offset,y,along];
      const scale=(length,height,thickness)=>axis==='x'?[length,height,thickness]:[thickness,height,length];
      const steelPartition='outdoor:fence:'+side,curbPartition='outdoor:curb:'+side;
      for(const [a,b] of segments){
        // Raised curb, lower crash rail, closely spaced welded bars and real
        // posts. The collision is the rendered geometry, not a hidden wall.
        box('plinth',point((a+b)/2,.1),scale(b-a,.2,.34),true,undefined,curbPartition);
        for(const y of [.48,1.16,2.08])box('steel',point((a+b)/2,y),scale(b-a,y===.48?.19:.055,y===.48?.12:.045),true,undefined,steelPartition);
        const count=Math.ceil((b-a)/.36);
        for(let n=0;n<=count;n++)box('steel',point(a+(b-a)*n/count,1.13),scale(.014,1.9,.014),true,undefined,steelPartition);
        const bays=Math.ceil((b-a)/3.2);
        for(let n=0;n<=bays;n++){
          const along=a+(b-a)*n/bays;box('steel',point(along,1.12),scale(.085,2.24,.085),true,undefined,steelPartition);
          box('trim',point(along,.028),scale(.2,.055,.2));
        }
        boundary.push({side,axis,coordinate:at,from:a,to:b,curbHeight:.2,fenceHeight:2.24,barSpacingMax:.36});
      }
    }
    const access=[{id:plan.id+'-yard-vehicle-entry',kind:'vehicle',axis:'x',wallCoordinate:site.maxZ,center:gateX,width:10,height:5},
      {id:plan.id+'-yard-pedestrian-entry',kind:'pedestrian',axis:'x',wallCoordinate:site.maxZ,center:0,width:2,height:2.3}];
    fence('z',site.minX,site.minZ,site.maxZ,'left');fence('z',site.maxX,site.minZ,site.maxZ,'right');
    fence('x',site.minZ,site.minX,site.maxX,'back');fence('x',site.maxZ,site.minX,site.maxX,'front',access.map(a=>({center:a.center,width:a.width})));
    // The approach road terminates at a closed physical boundary before the
    // terrain edge. Drone inspection remains free; returning to walking uses
    // native placement against the same visible boundary, never a fake floor.
    const worldBoundary={minX:-92.8,maxX:92.8,minZ:-92.8,maxZ:92.8,height:2.4,thickness:.5};
    for(const [side,x] of [['left',worldBoundary.minX],['right',worldBoundary.maxX]])box('plinth',[x,1.2,0],[.5,2.4,186.1],true,undefined,'outdoor:curb:'+side);
    for(const [side,z] of [['back',worldBoundary.minZ],['front',worldBoundary.maxZ]])box('plinth',[0,1.2,z],[185.1,2.4,.5],true,undefined,'outdoor:curb:'+side);
    // Galvanized gate-end posts double as impact bollards; rubber bands and the
    // ground safety paint distinguish them. Nothing crosses the clear aperture.
    for(const entry of access)for(const side of [-1,1]){
      const x=entry.center+side*(entry.width/2+.24),z=site.maxZ-.45;
      box('steel',[x,.6,z],[.18,1.2,.18],true,undefined,'outdoor:fence:front');
      box('dark',[x,1.03,z],[.194,.045,.194]);
    }
    // Two neighbouring, closed industrial buildings give the exterior scale
    // and a horizon beyond the fenced paved yard. Each is its own thin spatial
    // bank, so the empty yard cannot become an enclosing CAD solid.
    const context=[];
    for(const side of [-1,1]){
      const x=side<0?site.minX-14:site.maxX+14,z=site.minZ-13,w=18,d=14,h=6.4,partition='outdoor:neighbour:'+side;
      for(const edge of [-1,1]){
        box('wall',[x+edge*w/2,h/2,z],[.18,h,d],true,undefined,partition);
        box('wall',[x,h/2,z+edge*d/2],[w,h,.18],true,undefined,partition);
      }
      box('roof',[x,h+.05,z],[w+.4,.12,d+.4]);
      for(let at=x-w/2+1;at<x+w/2;at+=2)box('trim',[at,h+.14,z],[.035,.08,d+.4]);
      // Roof services and a front shutter visibly belong to the same shell.
      box('steel',[x+4,h+.42,z-3],[2.3,.7,1.6]);
      box('dark',[x,2.3,z+d/2+.11],[4.8,4.6,.045]);
      for(let y=.25;y<4.6;y+=.35)box('trim',[x,y,z+d/2+.14],[4.6,.025,.025]);
      box('dark',[x-w*.31,4.35,z+d/2+.105],[3,.72,.04]);
      context.push({kind:'industrial-warehouse',position:[x,0,z],width:w,depth:d,height:h});
    }
    return {version:1,siteBounds:site,groundBounds:ground,physicalBounds:{...ground,minY:-.24,maxY:7.28},worldBoundary,pavementRects:pavingRects,terrainRects,sourceFloorRects:sourceRects,
      road:{axis:'z',center:gateX,width:10,from:site.maxZ,to:ground.maxZ},entrances:access,boundary,context,
      markings:{walkway:[-.8,bounds.maxZ+1,.8,site.maxZ],bays:[[gateX-4.5,site.minZ+3,gateX+4.5,site.minZ+11]],
        arrows:[[gateX,site.maxZ-5,0],[gateX,site.maxZ-14,0],[gateX,site.maxZ+10,0]],
        crossings:[[gateX-4.8,bounds.maxZ+3.5,gateX+4.8,bounds.maxZ+5]],
        labels:[[gateX,site.maxZ-3,0,7,.6,15],[gateX,89.2,Math.PI,7,.6,13]],signs:[[gateX+5.9,site.maxZ-2.4,0,1,6],[1.6,site.maxZ-1.2,0,0,10],[gateX+4.7,90.3,Math.PI,1,6]]}};
  }
  try {
    const floor=slab('Interior · piso de hormigón · planta original '+width+' × '+depth+' m',0,0,width,depth,true);
    if(profile.left)slab('Patio separado · maniobra real del camión · hormigón texturado',-width/2-7,0,14,depth);
    if(profile.right)slab('Patio derecho separado · maniobra real del camión · hormigón texturado',width/2+7,0,14,depth);
    if(continuation)slab('Continuación física y pasillo reservado a CEDI-02 · sin generación de stock',width/2+5,0,10,depth);
    const totalWidth=bounds.maxX-bounds.minX;
    slab('Instalación · pasillo perimetral posterior', (bounds.minX+bounds.maxX)/2,-depth/2-perimeter/2,totalWidth,perimeter);
    slab('Instalación · pasillo perimetral frontal', (bounds.minX+bounds.maxX)/2,depth/2+perimeter/2,totalWidth,perimeter);
    if(!profile.left)slab('Instalación · margen lateral izquierdo',-width/2-perimeter/2,0,perimeter,depth);
    if(!profile.right)slab('Instalación · margen lateral derecho',width/2+continuation+perimeter/2,0,perimeter,depth);
    if(!profile.left)slab('Instalación · acceso exterior de servicio',bounds.minX-1.4,0,2.8,5.8);
    slab('Instalación · salida peatonal exterior',0,bounds.maxZ+1,2.4,2);
    const outdoor=exterior();

    const leftWidth=['CEDI-01','SF-01'].includes(plan.id)?depth-1.2:profile.left?6:3.6,rightWidth=profile.right?8:0;
    gateway('left',0,leftWidth,4.8,profile.left?'Recepción lateral desde patio':'Acceso de materiales');
    if(profile.right)gateway('right',0,rightWidth,4.8,'Expedición al patio');
    wall('z',bounds.minX,bounds.minZ,bounds.maxZ,[{center:0,width:leftWidth,height:4.8}]);
    wall('z',bounds.maxX,bounds.minZ,bounds.maxZ,profile.right?[{center:0,width:rightWidth,height:4.8}]:[]);
    wall('x',bounds.minZ,bounds.minX,bounds.maxX,[],true);
    wall('x',bounds.maxZ,bounds.minX,bounds.maxX,[{center:0,width:1.45,height:2.45}],true);
    openings.push({id:plan.id+'-pedestrian-exit',side:'front',axis:'x',wallCoordinate:bounds.maxZ,center:0,width:1.45,height:2.45,purpose:'Salida peatonal'});
    for(const x of [-.78,.78])box('green',[x,1.26,bounds.maxZ],[.1,2.52,.23],true);
    box('green',[0,2.53,bounds.maxZ],[1.65,.14,.23],true);
    // An open door leaf is beside the clear aperture; the push bar has no
    // collision proxy across the doorway.
    box('green',[.88,1.21,bounds.maxZ+.72],[.065,2.4,1.38]);
    box('trim',[.835,1.05,bounds.maxZ+.72],[.045,.04,.82]);

    const frameZ=[bounds.minZ+.35,0,bounds.maxZ-.35],span=bounds.maxX-bounds.minX;
    for(const z of frameZ){
      for(const x of [bounds.minX+.23,bounds.maxX-.23]){
        if((x<0&&Math.abs(z)<leftWidth/2+.3)||(x>0&&profile.right&&Math.abs(z)<rightWidth/2+.3))continue;
        box('steel',[x,3.5,z],[.12,7,.24],true);
        for(const edge of [-1,1])box('steel',[x+edge*.095,3.5,z],[.07,7,.3],true);
        box('trim',[x,.045,z],[.42,.09,.46],true);
        for(const a of [-1,1])for(const b of [-1,1])cylinder('trim',[x+a*.14,.12,z+b*.16],.025,.055);
        box('yellow',[x, .63,z],[.43,1.15,.46],true);
      }
      box('steel',[(bounds.minX+bounds.maxX)/2,6.87,z],[span,.13,.22]);
      for(const y of [6.73,7.01])box('steel',[(bounds.minX+bounds.maxX)/2,y,z],[span,.065,.39]);
      const pieces=6;for(let n=0;n<pieces;n++){const a=bounds.minX+span*n/pieces,b=bounds.minX+span*(n+1)/pieces;beam([a,6.7,z],[b,6.22,z],.065);beam([a,6.22,z],[b,6.7,z],.065);}
    }
    for(const fraction of [.2,.5,.8])box('roof',[bounds.minX+span*fraction,7.075,0],[.09,.16,bounds.maxZ-bounds.minZ]);
    box('roof',[(bounds.minX+bounds.maxX)/2,7.22,0],[span+.3,.12,bounds.maxZ-bounds.minZ+.3],true);
    for(let x=bounds.minX+.4;x<bounds.maxX;x+=1.1)box('trim',[x,7.145,0],[.022,.035,bounds.maxZ-bounds.minZ]);
    const fixtureXs=[-.28,0,.28].map(n=>(bounds.minX+bounds.maxX)/2+span*n),fixtureZs=[-depth*.28,depth*.28];
    for(const x of fixtureXs)for(const z of fixtureZs){
      box('steel',[x,6.03,z],[1.88,.12,.44]);box('light',[x,5.956,z],[1.72,.025,.34]);
      for(const offset of [-.65,.65])cylinder('trim',[x+offset,6.47,z],.009,.8);
    }
    // High service tray and perimeter conduit terminate at a real junction box.
    const trayX=bounds.minX+span*.2;
    box('roof',[trayX,6.43,0],[.34,.035,depth]);
    for(const side of [-1,1])box('roof',[trayX+side*.18,6.5,0],[.035,.16,depth]);
    for(let z=-depth/2;z<depth/2;z+=1.1)box('trim',[trayX,6.51,z],[.34,.025,.035]);
    box('steel',[bounds.maxX-.16,1.5,bounds.minZ+.8],[.16,.42,.35]);
    cylinder('trim',[bounds.maxX-.19,3.77,bounds.minZ+.8],.018,4.1);

    // Fire point: actual bottle, valve, hose and wall bracket, not a text-only
    // placeholder. Keep it in the perimeter, clear of the source machine zone.
    const fireX=bounds.minX+1.1,fireZ=bounds.maxZ-.21;
    cylinder('red',[fireX,.92,fireZ],.105,.55);cylinder('trim',[fireX,1.225,fireZ],.035,.07);
    box('dark',[fireX,1.29,fireZ],[.18,.045,.08]);cylinder('dark',[fireX+.12,1.02,fireZ],.018,.46);
    box('steel',[fireX,.68,fireZ+.03],[.26,.04,.22]);

    let triangles=0,outdoorTriangles=0,outdoorBatches=0;
    for(const batch of batches.values()){
      const positions=batch.positions,descriptor={type:'cad',recipe:{steps:[{id:'s1',op:'primitive.mesh',params:{positions},inputs:[]}],output:'s1'},mesh:{positions},color:FINISHES[batch.key].color,smoothingAngle:0};
      const object=doc.addCAD(roomId,descriptor);doc.setProperty(object,'name',(batch.outdoor?'Exterior industrial · ':'Instalación · ')+FINISHES[batch.key].name+(batch.collision?' · estructura física':' · detalles'));
      doc.setTransform(object,{position:[0,0,0],scale:[1,1,1]});
      doc.setBehaviors(object,[Object.assign(schema.defaultBehavior('collision'),{enabled:batch.collision}),...(batch.key==='paving'||batch.key==='terrain'?[schema.defaultBehavior('teleport')]:[]),finish(batch.key)]);
      object.userData.practiceFacility={role:batch.outdoor?(batch.key==='paving'||batch.key==='terrain'?'outdoor-ground':'outdoor-envelope'):batch.collision?'envelope':'detail',practiceId:plan.id,finish:batch.key,bakedParts:batch.parts,...(batch.outdoor?{partition:batch.partition}:{})};
      objects.push(object);created.push(object);triangles+=positions.length/9;
      if(batch.outdoor){outdoorTriangles+=positions.length/9;outdoorBatches++;}
    }
    const text=[profile.title,profile.zone,'SALIDA PEATONAL','EXTINTOR','USO DE EPP','NO OBSTRUIR','CIRCULACIÓN PEATONAL','ACCESO · PATIO INDUSTRIAL'];
    const backZ=-depth/2-perimeter*.54,frontZ=depth/2+perimeter*.54;
    const marks=doc.addIndustrialFloorPresentation(roomId,{type:'industrialFloor',version:1,bounds:[bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ],floorY:.005,texts:text,
      walkways:[[bounds.minX+.5,backZ-.55,bounds.maxX-.5,backZ+.55],outdoor.markings.walkway],
      zones:[[-width/2+.35,-depth/2+.35,width/2+continuation-.35,depth/2-.35]],
      crossings:(profile.left?[[-width/2-1.1,depth/2-.1,-width/2+1.1,depth/2+1.15]]:[]).concat(outdoor.markings.crossings),bays:outdoor.markings.bays,arrows:outdoor.markings.arrows,
      labels:[[(bounds.minX+bounds.maxX)/2,frontZ,Math.PI,Math.min(8,span*.5),.55,8],[0,bounds.maxZ-.8,0,1.35,.32,10],[width*.22,backZ,0,Math.min(5,span*.25),.35,14]].concat(outdoor.markings.labels),
      signs:[[fireX+.45,fireZ-.08,Math.PI,0,11],[-width/2+1.5,bounds.maxZ-.48,Math.PI,1,12],[width/2+continuation-1.3,bounds.maxZ-.48,Math.PI,1,9]].concat(outdoor.markings.signs)});
    doc.setProperty(marks,'name','Instalación · señalética de seguridad y pasillos');doc.setBehaviors(marks,[Object.assign(schema.defaultBehavior('collision'),{enabled:false})]);marks.userData.practiceFacility={role:'signage',practiceId:plan.id};objects.push(marks);created.push(marks);
    const environment=Object.assign(schema.studio.defaultEnvironment(roomId),{sky:'color',skyColor:'#b9c9cf',horizonColor:'#d7dfdc',groundColor:'#7f8b83',sunColor:'#fff4e0',sunIntensity:1.02,ambientIntensity:.58,exposure:1.02,shadows:false,renderQuality:'balanced'});
    doc.setStudio({environments:(doc.studio&&doc.studio.environments||[]).filter(row=>row.roomId!==roomId).concat(environment)});
    outdoor.objectIds=created.filter(object=>object.userData.practiceFacility.role.startsWith('outdoor-')).map(object=>object.userData.editorId);outdoor.signageObjectId=marks.userData.editorId;
    outdoor.costs={batches:outdoorBatches,bakedGeometryTriangles:outdoorTriangles,dynamicLights:0,shadowMaps:0};
    return {version:1,profile:plan.id,objects:created.map(object=>Object.assign({objectId:object.userData.editorId},object.userData.practiceFacility)),floor,floors,bounds,openings,outdoor,physicalParts:parts,
      adaptations:[{kind:'facility-perimeter',reason:'Pasillo perimetral físico de 1.8 m para cerramientos, estructura y evacuación fuera de la distribución original; la planta y las poses de los equipos no se escalan.',sourceArea:{width,depth},perimeter,continuation},...(['CEDI-01','SF-01'].includes(plan.id)?[{kind:'lateral-receiving-aperture',side:'left',clearWidth:leftWidth,clearHeight:4.8,reason:'Apertura lateral continua para retirada y giro de un pallet del camión físico; conserva los segmentos extremos de pared, los montantes y la salida peatonal. La puerta de seis metros bloqueaba el radio de giro de SF-01.'}]:[]),...(profile.right?[{kind:'side-loading-dispatch-aperture',side:'right',clearWidth:rightWidth,clearHeight:4.8,reason:'Apertura de expedición con paso lateral al muelle y a los espejos del camión físico; conserva los bordes y evita conducir un vehículo a piso sobre la plataforma elevada del muelle.'}]:[])],
      costs:{bakedGeometryTriangles:triangles,batches:batches.size,parts:[...batches.values()].reduce((n,b)=>n+b.parts,0),dynamicLights:0,shadowMaps:0},environment,
      references:['https://www.hse.gov.uk/WORKPLACETRANSPORT/information/safeworkplace.htm','https://www.hse.gov.uk/workplacetransport/lighting.htm'],
      limits:'Instalación didáctica genérica; las aperturas y las rutas requieren validación de contacto en la configuración elegida. No acredita certificación legal, iluminación en lux ni FPS físicos del visor.'};
  } finally {boxGeometry.dispose();cylinderGeometry.dispose();}
}
