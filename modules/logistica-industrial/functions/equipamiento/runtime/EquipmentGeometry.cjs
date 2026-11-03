'use strict';

// Parametric educational exteriors, built in the same metre frame as the
// catalogue layout and native handling surfaces. No independent machine logic.
const surfaces = require('./EquipmentSurfaces.cjs');
const VERSION = 2;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const finite = (v,f)=>Number.isFinite(v)?v:f;
const NATIVE_TRANSPORT = new Set(['roller-gravity','roller-box','flat-belt','modular-belt','pallet-chain','zero-pressure','curve','popup-transfer','turntable','pusher','merge','junction','vertical-lift','stops-guides']);
const NATIVE_STORAGE = new Set(['selective','double-deep','drive-in','drive-through','push-back','pallet-flow','carton-flow','cantilever','mobile','light-medium','mezzanine','vertical-lift','miniload','block']);
const NATIVE_PRODUCTS = new Set(['wood-pallet','plastic-pallet','standard-pallet','loaded-pallet','carton','tote','roll-container','sack','drum','bottle-can-tray','discrete-part','metal-part','fragile-electronic','textile','hazardous']);
function keepNative(def) {
  return def.geometryPolicy==='native-rig' || def.role==='robot' || ['vehicle','mobile'].includes(def.role)&&!!def.nativeVariant&&!['freight-truck','overhead-crane','ergonomic-manipulator','sideload-multidirectional','inventory-drone'].includes(def.mechanism) ||
    def.role==='transport'&&NATIVE_TRANSPORT.has(def.mechanism) || def.role==='storage'&&NATIVE_STORAGE.has(def.mechanism) || def.role==='product'&&NATIVE_PRODUCTS.has(def.mechanism) ||
    def.role==='control'&&def.mechanism!=='charging-station';
}

function builder(THREE,def,cfg,layout) {
  const root=new THREE.Group(),groups=new Map(),banks=new Map(),materials=new Map(),geometries=new Map(),name=def.id;
  root.name=def.title||name;root.userData.catalogueEquipmentId=name;root.userData.equipmentGeometry={version:VERSION,family:def.geometryFamily,variant:def.geometryVariant,units:'m',operationLevel:def.operationLevel};
  const frame=cfg.frameColor||'#466574',accent=cfg.accentColor||'#e9b849';
  const colors={paint:frame,accent,steel:'#bbc5ca',aluminum:'#b8c1c7',rubber:'#252d32',plastic:'#3c5361',wood:'#b99b70',cardboard:'#b99a72',glass:'#9bb8c2',optical:'#19394b',red:'#c34f47',green:'#50a87e'};
  const component=(id,label,parent=root)=>{const key=parent.uuid+':'+id;if(!groups.has(key)){const g=new THREE.Group();g.name=label||id;g.userData.equipmentComponentId=name+'.'+id;g.userData.equipmentPartRole=id;parent.add(g);groups.set(key,g);}return groups.get(key);};
  const moving=(id,label,pivot,motion)=>{const g=component(id,label);g.position.fromArray(pivot);g.userData.equipmentGeometryOrigin=pivot.slice();g.userData.equipmentMotion=Object.assign({},motion);return g;};
  const material=role=>{if(!materials.has(role)){const normalized=['accent','red','green'].includes(role)?'paint':role,extra=role==='glass'?{transparent:true,opacity:.17,depthWrite:false}:normalized==='paint'?{roughness:.43+clamp(finite(cfg.wear,.12),0,1)*.15}:{};materials.set(role,surfaces.createSurface(THREE,'Equipo / '+role,colors[role]||role,extra,normalized));}return materials.get(role);};
  const geometry=(key,make)=>{if(!geometries.has(key))geometries.set(key,make());return geometries.get(key);};
  const append=(part,role,g,position=[0,0,0],rotation,scale=[1,1,1],label='')=>{
    const parent=typeof part==='string'?component(part):part;const k=parent.uuid+':'+role;let bank=banks.get(k);if(!bank){bank={parent,role,p:[],n:[],uv:[],i:[],names:new Set()};banks.set(k,bank);}
    const origin=parent.userData.equipmentGeometryOrigin||[0,0,0],at=position.map((v,i)=>v-origin[i]),matrix=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(at),rotation||new THREE.Quaternion(),new THREE.Vector3().fromArray(scale)),normal=new THREE.Matrix3().getNormalMatrix(matrix),p=new THREE.Vector3(),n=new THREE.Vector3(),start=bank.p.length/3,attr=g.attributes;
    for(let i=0;i<attr.position.count;i++){p.fromBufferAttribute(attr.position,i).applyMatrix4(matrix);n.fromBufferAttribute(attr.normal,i).applyMatrix3(normal).normalize();bank.p.push(p.x,p.y,p.z);bank.n.push(n.x,n.y,n.z);bank.uv.push(attr.uv?attr.uv.getX(i):0,attr.uv?attr.uv.getY(i):0);}
    const count=g.index?g.index.count:attr.position.count;for(let i=0;i<count;i++)bank.i.push(start+(g.index?g.index.getX(i):i));if(label)bank.names.add(label);return parent;
  };
  const fabricated=(s,channel)=>{
    const [w,h,d]=s;
    if(channel){
      const axis=w>=h&&w>=d?'x':h>=d?'y':'z',a=axis==='x'?d:w,b=axis==='y'?d:h,length=axis==='x'?w:axis==='y'?h:d,t=Math.min(.004,Math.min(a,b)*.13);
      const points=[[-a/2,-b/2],[a/2,-b/2],[a/2,b/2],[a/2-t,b/2],[a/2-t,-b/2+t],[-a/2+t,-b/2+t],[-a/2+t,b/2],[-a/2,b/2]],shape=new THREE.Shape(points.map(p=>new THREE.Vector2(...p))),g=new THREE.ExtrudeBufferGeometry(shape,{depth:length,steps:1,bevelEnabled:false,curveSegments:1});g.translate(0,0,-length/2);if(axis==='x')g.rotateY(Math.PI/2);if(axis==='y')g.rotateX(Math.PI/2);g.userData.manufacturedProfile='folded-open-channel';return g;
    }
    const r=Math.min(.004,Math.min(w,h,d)*.12),x=w/2-r,y=h/2-r,shape=new THREE.Shape();shape.moveTo(-x,-y);shape.lineTo(x,-y);shape.lineTo(x,y);shape.lineTo(-x,y);shape.closePath();
    const g=new THREE.ExtrudeBufferGeometry(shape,{depth:d-2*r,steps:1,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelSegments:1,curveSegments:1});g.translate(0,0,-d/2+r);g.userData.manufacturedProfile='edge-broken-sheet';return g;
  };
  const box=(part,role,p,s,label='')=>{
    const metal=['paint','accent','steel','aluminum','red','green'].includes(role),channel=metal&&/Pata tubular|Larguero|Montante|Viga carril|Travesaño|Perfil|Columna portapallets|Carril|Guías [XYZ]/i.test(label),shaped=metal&&Math.min(...s)>.012;
    const g=geometry((channel?'channel:':shaped?'sheet:':'box:')+s.join(':'),()=>channel||shaped?fabricated(s,channel):new THREE.BoxBufferGeometry(...s));
    const parent=append(part,role,g,p,undefined,[1,1,1],label);
    if(['frame','enclosure'].includes(typeof part==='string'?part:part.userData.equipmentPartRole)&&metal&&s[0]>.30&&s[1]>.18&&s[2]>.06){
      const anchors=root.userData.industrialStickerAnchors||(root.userData.industrialStickerAnchors=[]);
      if(anchors.length<2)anchors.push({id:anchors.length?'warning-pinch':'equipment-id',position:[p[0],p[1],p[2]+s[2]/2],normal:[0,0,1],size:[Math.min(.22,s[0]*.45),Math.min(.075,s[1]*.25)]});
    }
    return parent;
  };
  const cylinder=(part,role,p,r,h,axis='y',segments=16,label='')=>{
    const q=axis==='x'?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-Math.PI/2):axis==='z'?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2):undefined;
    return append(part,role,geometry('cyl:'+segments,()=>new THREE.CylinderBufferGeometry(1,1,1,segments,1)),p,q,[r,h,r],label);
  };
  const cone=(part,role,p,r1,r2,h,axis='y',label='')=>{
    const q=axis==='x'?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-Math.PI/2):axis==='z'?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2):undefined;
    return append(part,role,geometry('cone:'+r1+':'+r2+':'+h,()=>new THREE.CylinderBufferGeometry(r1,r2,h,20,1)),p,q,[1,1,1],label);
  };
  const spool=(part,role,p,r,width,core=.035,axis='z',label='')=>{
    const g=geometry('spool:'+r+':'+width+':'+core,()=>{const s=new THREE.Shape(),hole=new THREE.Path();s.absarc(0,0,r,0,Math.PI*2,false);hole.absarc(0,0,core,0,Math.PI*2,true);s.holes.push(hole);const geo=new THREE.ExtrudeBufferGeometry(s,{depth:width,steps:1,bevelEnabled:false,curveSegments:16});geo.translate(0,0,-width/2);return geo;});
    const q=axis==='y'?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2):axis==='x'?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2):undefined;return append(part,role,g,p,q,[1,1,1],label);
  };
  const beam=(part,role,a,b,thickness=.045,label='')=>{const pa=new THREE.Vector3().fromArray(a),pb=new THREE.Vector3().fromArray(b),v=pb.clone().sub(pa),length=v.length();if(length<1e-6)return;return append(part,role,geometry('box',()=>new THREE.BoxBufferGeometry(1,1,1)),pa.add(pb).multiplyScalar(.5).toArray(),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.divideScalar(length)),[thickness,length,thickness],label);};
  const tube=(part,role,points,r=.012,label='')=>{if(points.length<2)return;const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3().fromArray(p))),g=new THREE.TubeBufferGeometry(curve,Math.min(48,Math.max(8,points.length*4)),r,6,false);append(part,role,g,[0,0,0],undefined,[1,1,1],label);g.dispose();};
  const ring=(part,role,p,r,t,axis='z',label='')=>{const q=axis==='y'?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2):axis==='x'?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2):undefined,g=geometry('ring:'+r+':'+t,()=>new THREE.TorusBufferGeometry(r,t,6,20));append(part,role,g,p,q,[1,1,1],label);};
  const bolt=(part,p,axis='y',radius=.012)=>cylinder(part,'steel',p,radius,.014,axis,6,'Tornillo hexagonal');
  const feet=(length,width,top=0,floor=-1)=>{
    const span=top-floor-.16;if(span<=.08)return;
    for(const x of [-1,1])for(const z of [-1,1]){const px=x*(length/2-.13),pz=z*(width/2-.10);box('frame','paint',[px,floor+.08+span/2,pz],[.065,span,.065],'Pata tubular');cylinder('frame','rubber',[px,floor+.018,pz],.065,.036);cylinder('frame','steel',[px,floor+.07,pz],.017,.09);bolt('frame',[px,floor+.11,pz]);}
    for(const z of [-1,1])box('frame','paint',[0,floor+.24,z*(width/2-.10)],[Math.max(.1,length-.22),.05,.04],'Travesaño');
  };
  const deck=(length,width,y=0,floor=layout.floor,roller=false)=>{
    for(const z of [-1,1]){box('frame','paint',[0,y-.13,z*(width/2+.025)],[length,.18,.055],'Larguero');box('frame','steel',[0,y-.038,z*(width/2+.025)],[length,.025,.085],'Ala del perfil');for(const x of [-1,1])bolt('frame',[x*(length/2-.09),y-.013,z*(width/2+.025)]);}
    if(roller){const count=clamp(Math.ceil(length/.19),3,28),r=Math.min(.046,width*.06);for(let i=0;i<count;i++){const x=-length/2+.065+(length-.13)*i/(count-1);cylinder('surface','steel',[x,y-r,0],r,width,'z',12,'Rodillo');for(const z of [-1,1])cylinder('drive','rubber',[x,y-r,z*(width/2+.03)],r*.6,.02,'z',10,'Cojinete');}}
    else{box('surface','rubber',[0,y-.018,0],[length,.036,width],'Banda de transporte');box('surface','rubber',[0,y-.12,0],[Math.max(.05,length-.08),.022,width*.96],'Retorno inferior de la banda');for(const x of [-1,1])cylinder('drive','steel',[x*(length/2-.05),y-.065,0],.05,width,'z',16,'Tambor');}
    feet(length,width,y,floor);return y;
  };
  const pathDeck=(points,width,rail=true)=>{
    if(!Array.isArray(points)||points.length<2)throw new Error('Transport geometry needs the authoritative path points.');
    const p=[],n=[],uv=[],i=[],outer=[],inner=[];
    points.forEach((point,index)=>{const a=points[Math.max(0,index-1)],b=points[Math.min(points.length-1,index+1)],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)||1,sx=-dz/length,sz=dx/length;
      for(const sign of [-1,1]){p.push(point[0]+sx*width*.5*sign,point[1],point[2]+sz*width*.5*sign);n.push(0,1,0);uv.push(index*.15,sign<0?0:1);}outer.push([point[0]+sx*(width/2+.025),point[1]+.10,point[2]+sz*(width/2+.025)]);inner.push([point[0]-sx*(width/2+.025),point[1]+.10,point[2]-sz*(width/2+.025)]);
      if(index){const k=(index-1)*2;i.push(k,k+3,k+2,k,k+1,k+3);}
    });
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(i);append('surface','rubber',g);g.dispose();
    if(rail){tube('guides','steel',outer,.014,'Guía sobre recorrido real');tube('guides','steel',inner,.014,'Guía sobre recorrido real');}
    for(let index=0;index<points.length;index+=Math.max(1,Math.floor(points.length/8))){const point=points[index],height=point[1]-layout.floor-.08;if(height>.08)box('frame','paint',[point[0],layout.floor+height/2,point[2]],[.055,height,.055],'Pata tubular');}
    root.userData.catalogueSurfacePath=points.map(p=>p.slice());root.userData.catalogueSurfaceWidth=width;
  };
  let motorIndex=0;
  const motor=(p=[0,0,0],axis='x',size=1)=>{
    const g=component('drive','Motor, reductor y transmisión'),q=axis==='z'?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2):new THREE.Quaternion();
    const local=(v)=>new THREE.Vector3().fromArray(v).multiplyScalar(size).applyQuaternion(q).add(new THREE.Vector3().fromArray(p)).toArray();
    cylinder(g,'aluminum',local([.10,0,0]),.09*size,.26*size,axis,16,'Carcasa del motor');
    cylinder(g,'steel',local([-.06,0,0]),.095*size,.035*size,axis,16,'Brida del motor');
    box(g,'paint',local([-.17,-.02,0]),[.18*size,.20*size,.20*size],'Reductor');
    for(let i=0;i<10;i++){const a=i*Math.PI/5;box(g,'aluminum',local([.10,Math.cos(a)*.09,Math.sin(a)*.09]),[.22*size,.012*size,.012*size],'Aletas del motor');}
    box(g,'paint',local([.08,.11,0]),[.10*size,.05*size,.09*size],'Caja de bornes');tube(g,'rubber',[local([.08,.13,0]),local([.10,.17,.1]),local([-.15,.13,.18])],.009*size,'Cable conectado');
    const pivot=local([.23,0,0]),rotor=moving('drive-coupling-'+motorIndex++,'Acoplamiento del motor',pivot,{kind:'rotate',axis,turns:6});cylinder(rotor,'steel',pivot,.035*size,.07*size,axis,12,'Acoplamiento de salida');return g;
  };
  const actuator=(part,a,b,r=.04)=>{const aa=new THREE.Vector3().fromArray(a),bb=new THREE.Vector3().fromArray(b),v=bb.clone().sub(aa),length=v.length(),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize()),p=aa.clone().addScaledVector(v,.32);append(part,'paint',geometry('cyl:16',()=>new THREE.CylinderBufferGeometry(1,1,1,16)),p.toArray(),q,[r,length*.64,r],'Camisa del cilindro');p.copy(aa).addScaledVector(v,.78);append(part,'steel',geometry('cyl:12',()=>new THREE.CylinderBufferGeometry(1,1,1,12)),p.toArray(),q,[r*.45,length*.44,r*.45],'Vástago');};
  const guard=(length,width,bottom,height,frontOpen=true)=>{
    for(const x of [-1,1])for(const z of [-1,1])box('enclosure','aluminum',[x*length/2,bottom+height/2,z*width/2],[.045,height,.045],'Perfil de resguardo');
    for(const z of [-1,1])box('enclosure','aluminum',[0,bottom+height,z*width/2],[length,.045,.045]);
    for(const x of [-1,1])box('enclosure','aluminum',[x*length/2,bottom+height,0],[.045,.045,width]);
    box('enclosure','glass',[0,bottom+height*.5,-width/2],[length-.05,height-.07,.008],'Resguardo posterior');
    for(const x of [-1,1])box('enclosure','glass',[x*length/2,bottom+height*.5,0],[.008,height-.07,width-.05],'Resguardo lateral');
    if(!frontOpen)box('enclosure','glass',[0,bottom+height*.5,width/2],[length-.05,height-.07,.008]);
  };
  const sensor=(p,axis='z')=>{box('sensing','plastic',p,[.055,.085,.04],'Fotocélula');cylinder('sensing','optical',[p[0],p[1],p[2]+(axis==='z'?.025:0)],.015,.007,axis,12,'Lente');tube('sensing','rubber',[[p[0],p[1]-.04,p[2]],[p[0],p[1]-.13,p[2]+.03],[p[0]-.12,p[1]-.18,p[2]+.03]],.005,'Cable de sensor');};
  const panel=(p=[0,.7,0],width=.35,height=.30)=>{box('control','paint',p,[width,height,.08],'Caja de mando');box('control','optical',[p[0]-.025,p[1]+height*.12,p[2]+.044],[width*.64,height*.42,.008],'Pantalla');cylinder('control','red',[p[0]+width*.31,p[1]-height*.23,p[2]+.055],.025,.025,'z',12,'Emergencia');cylinder('control','green',[p[0]-width*.25,p[1]-height*.26,p[2]+.05],.015,.014,'z',12,'Indicador');};
  const finish=()=>{
    banks.forEach(b=>{if(!b.p.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));g.setIndex(b.i);g.computeBoundingBox();g.computeBoundingSphere();const m=new THREE.Mesh(g,material(b.role));m.name=b.parent.name+' / '+b.role;m.castShadow=b.role!=='glass';m.receiveShadow=true;Object.assign(m.userData,{equipmentComponentId:b.parent.userData.equipmentComponentId,industrialMaterialRole:b.role==='accent'?'frame':b.role,industrialMaterialPart:b.role,equipmentSourceParts:[...b.names]});b.parent.add(m);});geometries.forEach(g=>g.dispose());root.updateMatrixWorld(true);return root;
  };
  return{THREE,root,component,moving,box,cylinder,cone,spool,beam,tube,ring,bolt,feet,deck,pathDeck,motor,actuator,guard,sensor,panel,finish,layout,cfg,def};
}

function packaging(b) {
  const {box,cylinder,beam,tube,ring,bolt,deck,motor,guard,sensor,component,layout:l,cfg:c,def}=b,v=def.mechanism,L=l.bodyLength||l.length,W=l.width,F=l.floor,H=clamp(l.height-(0-F),.8,2.5);
  if(v==='stretch-wrapper'){
    const r=Math.min(L*.34,W*.47),columnHeight=Math.max(1.4,l.height),columnTop=F+columnHeight,table=b.moving('turntable','Mesa giratoria de envoltura',[-L*.13,-.065,0],{kind:'rotate',axis:'y',turns:3});cylinder(table,'steel',[-L*.13,-.065,0],r,.13,'y',32,'Mesa giratoria');ring('drive','rubber',[-L*.13,-.09,0],r*.85,.025,'y');
    // Native processor ports are at deck y=0. A load-bearing pedestal joins
    // that raised worktable to the real installation floor; no floating disc.
    const bearingBottom=-.13,baseTop=F+.05,pedestalHeight=bearingBottom-baseTop;
    cylinder('frame','paint',[-L*.13,F+.025,0],r*.52,.05,'y',24,'Placa base de mesa');if(pedestalHeight>.02)cylinder('frame','paint',[-L*.13,(bearingBottom+baseTop)/2,0],r*.36,pedestalHeight,'y',24,'Pedestal de mesa giratoria');
    for(const sign of [-1,1])for(const side of [-1,1])bolt('frame',[-L*.13+sign*r*.30,F+.06,side*r*.30]);
    box('frame','paint',[L*.33,F+columnHeight/2,0],[.18,columnHeight,.22],'Columna de elevación');box('frame','paint',[L*.12,F+.06,0],[L*.60,.12,.42],'Base de columna');
    const carriage=component('actuator','Carro de preestiro');carriage.userData.equipmentMotion={kind:'linear',axis:'y',min:0,max:Math.max(.08,columnTop-.63)};
    box(carriage,'accent',[L*.24,.38,0],[.26,.52,.36],'Carro portabobina');cylinder(carriage,'plastic',[L*.12,.40,-.04],.105,.43,'y',20,'Bobina de film');for(const z of [-1,1])cylinder(carriage,'steel',[L*.05,.40,z*.17],.025,.44,'y',12,'Rodillo de preestiro');
    motor([L*.32,F+.18,.21]);box('control','paint',[L*.33,F+1.10,.16],[.22,.27,.07]);return;
  }
  if(['pallet-dispenser','depalletizer','layer-palletizer','robot-palletizer'].includes(v)){
    deck(L,W,0,F,true);for(const x of [-1,1])for(const z of [-1,1])box('frame','paint',[x*L*.33,.75,z*W*.52],[.10,1.55,.10],'Columna portapallets');
    for(const z of [-1,1])box('frame','paint',[0,1.50,z*W*.52],[L*.72,.12,.12]);
    const moving=component('actuator','Soporte elevable de la pila');moving.userData.equipmentMotion={kind:'linear',axis:'y',min:0,max:.4};
    for(const z of [-1,1]){box(moving,'accent',[0,.12,z*W*.47],[L*.56,.08,.12],'Uñas de apoyo');b.actuator('actuator',[-L*.32,.22,z*W*.57],[-L*.32,1.20,z*W*.57],.045);}
    for(const y of [.3,.7,1.1]){for(const x of [-1,1])box('guides','steel',[x*L*.31,y,0],[.035,.045,W*.93]);}sensor([-L*.30,.15,W*.56]);motor([-L*.20,-.28,W*.59]);return;
  }
  deck(L,W,0,F,true);motor([L*.25,-.23,W*.63]);
  if(['carton-sealer','seal-strap','strapper'].includes(v)){
    const archH=Math.min(1.05,H),archX=v==='carton-sealer'?L*.04:0;
    for(const z of [-1,1]){box('frame','paint',[archX,archH/2,z*(W*.5+.09)],[.13,archH,.13],'Montante regulable');box('drive','rubber',[0,.15,z*W*.36],[L*.66,.18,.07],'Correa lateral de arrastre');for(const x of [-1,1])cylinder('drive','steel',[x*L*.30,.15,z*W*.36],.08,.07,'z',16);}
    box('frame','paint',[archX,archH,0],[.25,.12,W+ .28],'Travesaño de arco');
    if(v==='carton-sealer'){
      const rollY=archH-.28,roll=b.moving('tape-roll','Bobina de encintado',[archX+.02,rollY,0],{kind:'rotate',axis:'z',turns:2});b.spool(roll,'cardboard',[archX+.02,rollY,0],.17,.07,.036,'z','Rollo de cinta');cylinder('actuator','steel',[archX+.02,rollY,0],.026,.22,'z',12,'Eje portabobina');for(const z of [-1,1])box('frame','steel',[archX-.10,archH-.18,z*.09],[.035,.24,.025],'Soporte portabobina');box('frame','steel',[archX-.17,(archH-.06+.56)/2,0],[.045,archH-.06-.56,.06],'Carro de ajuste del cabezal');
      box('actuator','accent',[archX-.05,.51,0],[.48,.10,.18],'Cabezal de encintado');beam('actuator','steel',[archX+.02,archH-.20,0],[archX-.20,.56,0],.025,'Guía de cinta');for(const z of [-1,1])beam('guides','steel',[-L*.34,.46,z*.24],[-L*.12,.34,z*.10],.025,'Plegador de solapas');
    }else{
      for(const z of [-1,1])box('actuator','accent',[0,archH*.48,z*W*.49],[.04,archH-.08,.045],'Guía del fleje');box('actuator','accent',[0,archH-.04,0],[.045,.04,W],'Guía superior del fleje');cylinder('drive','plastic',[L*.30,-.32,W*.66],.23,.10,'z',24,'Bobina de fleje');box('actuator','steel',[0,.04,0],[.22,.04,.2],'Soldador de fleje');
    }
    sensor([-L*.25,.15,W*.56]);return;
  }
  if(v==='print-apply'){
    const z=W*.55+.2;box('frame','paint',[0,.49,z],[.10,1.10,.10],'Columna impresora');box('enclosure','paint',[0,.83,z],[.56,.42,.26],'Impresora térmica');
    cylinder('drive','cardboard',[-.15,.93,z+.17],.13,.08,'z',24,'Bobina de etiquetas');cylinder('drive','plastic',[.15,.83,z+.17],.09,.08,'z',20,'Recogida del soporte');
    b.actuator('actuator',[0,.53,z],[0,.53,W*.14],.03);box('actuator','steel',[0,.53,W*.12],[.25,.12,.035],'Placa aplicadora');tube('drive','rubber',[[0,.68,z],[.17,.75,z-.05],[.17,.53,z-.18]],.009,'Tubo neumático conectado');sensor([-.35,.3,z-.15]);return;
  }
  if(v==='carton-erector'){
    guard(L*.60,W+.1,0,H,true);box('frame','paint',[-L*.36,.55,W*.37],[L*.28,.10,W*.50],'Almacén inclinado de cartón');
    for(let i=0;i<6;i++){const p=box('surface','cardboard',[-L*.38+i*.025,.65,W*.36],[.014,.75,W*.46],'Planchas de cartón');void p;}
    const arm=component('actuator','Brazo de apertura');b.actuator(arm,[-L*.15,.55,-W*.42],[.25,.55,-W*.03],.035);for(const z of [-1,1])cylinder(arm,'rubber',[.23,.52,z*.17],.045,.025,'x',12,'Ventosa de apertura');
    for(const z of [-1,1])beam('guides','steel',[.10,.30,z*.32],[L*.30,.08,z*.12],.035,'Plegador de fondo');cylinder('actuator','cardboard',[L*.23,-.2,0],.13,.08,'z',24,'Encintado inferior');return;
  }
  // A case packer has a portal and a guided head, not the carton erector magazine.
  guard(L*.68,W+.12,0,H,true);for(const z of [-1,1])beam('frame','aluminum',[-L*.27,H,z*W*.45],[L*.27,H,z*W*.45],.07,'Guía del pórtico');
  const head=component('actuator','Carro de encajonado');head.userData.equipmentMotion={kind:'linear',axis:'y',min:-.22,max:0};box(head,'accent',[0,H-.18,0],[.46,.18,.42]);for(const x of [-1,1])for(const z of [-1,1])cylinder(head,'rubber',[x*.16,H-.32,z*.14],.04,.05,'y',12,'Ventosa de encajonado');
}

function machine(b){
  const {box,cylinder,cone,beam,tube,ring,bolt,deck,motor,guard,sensor,component,layout:l,cfg:c,def}=b,v=def.mechanism,L=l.bodyLength||l.length,W=l.width,F=l.floor,top=0,H=clamp(l.height+F,.85,2.7),front=W/2;
  const base=()=>{box('frame','paint',[0,F*.50,0],[L*.86,-F*.9||.28,W*.86],'Bancada de la máquina');for(const x of [-1,1])for(const z of [-1,1]){cylinder('frame','rubber',[x*L*.35,F+.03,z*W*.35],.09,.06);bolt('frame',[x*L*.35,F+.07,z*W*.35]);}
    for(let i=0;i<3;i++){const x=(i-1)*L*.265,w=L*.25,h=Math.max(.18,-F*.66);box('enclosure','rubber',[x,F*.52,W*.432],[w+.012,h+.012,.006],'Junta de portezuela');box('enclosure','paint',[x,F*.52,W*.437],[w,h,.009],'Portezuela de mantenimiento');for(const y of [-1,1])cylinder('enclosure','steel',[x-w*.43,F*.52+y*h*.28,W*.445],.009,.07,'y',10,'Bisagra');box('control','rubber',[x+w*.34,F*.49,W*.449],[.018,h*.20,.02],'Tirador de puerta');for(let j=0;j<4;j++)box('enclosure','rubber',[x-w*.08,F*.52-h*.14+j*.025,W*.443],[w*.35,.006,.003],'Lama de ventilación');}
  };
  const table=()=>{box('surface','steel',[0,-.045,0],[L*.8,.09,W*.78],'Mesa de trabajo');for(const z of [-.23,0,.23])box('surface','rubber',[0,.001,z*W],[L*.76,.003,.012],'Ranura en T');};
  if(['assembly-bench','test-bench','fixture','insertion-press','cmm'].includes(v)){
    b.feet(L,W,0,F);table();
    if(v==='fixture'){for(const x of [-1,1]){box('actuator','steel',[x*L*.19,.07,0],[L*.16,.14,W*.36],'Mordaza');cylinder('drive','steel',[0,.07,0],.025,L*.50,'x',12,'Husillo de apriete');}ring('control','steel',[L*.33,.07,0],.14,.012,'x');}
    else if(v==='cmm'){for(const z of [-1,1])box('frame','aluminum',[0,H/2,z*W*.42],[.13,H,.13],'Puente de metrología');box('frame','aluminum',[0,H,0],[.16,.16,W*.92]);box('actuator','paint',[0,H*.65,0],[.12,H*.65,.12]);cylinder('sensing','steel',[0,H*.28,0],.015,.20,'y',12,'Palpador');cylinder('sensing','red',[0,H*.18,0],.022,.025,'y',12);}
    else if(v==='insertion-press'){box('frame','paint',[0,H*.5,-W*.30],[.22,H,.20]);box('frame','paint',[0,H,0],[.26,.16,W*.70]);b.actuator('actuator',[0,H-.03,0],[0,.20,0],.08);}
    else{box('frame','aluminum',[0,.48,-W*.45],[L,.06,.05],'Barra de utilidades');for(const x of [-1,1])box('frame','aluminum',[x*(L/2-.04),.24,-W*.45],[.05,.48,.05]);for(let i=0;i<5;i++)box('guides','plastic',[-L*.35+i*L*.175,.16,-W*.30],[L*.12,.19,.22],'Contenedor de componentes');if(v==='test-bench'){b.panel([L*.28,.38,-W*.18],.45,.32);for(const x of [-1,1])tube('sensing','rubber',[[L*.28+x*.09,.22,-W*.15],[x*.25,.12,0],[x*.25,.06,.15]],.008,'Sonda de ensayo');}}
    return;
  }
  if(['tank-mixer','hopper-doser','filler','pump-valve'].includes(v)){
    if(v==='pump-valve'){box('frame','paint',[0,F+.06,0],[L*.86,.12,W*.75],'Bancada de grupo de bombeo');motor([-L*.18,F+.29,0], 'x',1.5);box('frame','steel',[-L*.18,F+.15,0],[.42,.10,.28],'Pata del motor');cylinder('actuator','steel',[L*.06,F+.29,0],.19,.22,'x',24,'Cuerpo de bomba');for(const x of [0,L*.28]){cylinder('guides','steel',[x,F+.43,0],.055,.32,'y',16);ring('guides','steel',[x,F+.59,0],.075,.015,'y');}box('actuator','accent',[L*.28,F+.72,0],[.16,.16,.16],'Válvula');cylinder('control','steel',[L*.28,F+.87,0],.016,.22);ring('control','red',[L*.28,F+.98,0],.13,.014,'y');return;}
    if(v==='filler'){deck(L,W,0,F,false);const z=-W*.34;cylinder('enclosure','steel',[0,H*.75,z],.30,.48,'y',24,'Depósito dosificador');cone('enclosure','steel',[0,H*.43,z],.30,.06,.26);for(const x of [-1,0,1]){box('frame','aluminum',[x*L*.24,H*.43,-W*.42],[.06,H*.86,.06]);cylinder('actuator','steel',[x*L*.22,H*.22,0],.025,.28,'y',12,'Boquilla de llenado');tube('drive','rubber',[[0,H*.45,z],[x*L*.22,H*.45,z],[x*L*.22,H*.37,0]],.016,'Manguera del producto');}return;}
    const r=Math.min(L*.30,W*.43);b.feet(L*.72,W*.80,0,F);cylinder('enclosure','steel',[0,H*.35,0],r,H*.58,'y',32,'Depósito de proceso');cone('enclosure','steel',[0,H*.02,0],r,.055,H*.18);ring('enclosure','steel',[0,H*.64,0],r,.025,'y');cylinder('enclosure','steel',[0,H*.65,0],r*.96,.035,'y',24,'Tapa');
    if(v==='hopper-doser'){cone('enclosure','steel',[0,H*.80,0],r,r*.65,H*.33);cylinder('actuator','steel',[0,-.08,0],.065,.25,'y',16,'Salida del dosificador');}
    else{motor([0,H*.82,0],'x',1.1);cylinder('actuator','steel',[0,H*.32,0],.022,H*.60,'y',12,'Eje del agitador');for(const x of [-1,1])box('actuator','steel',[x*r*.25,H*.18,0],[r*.60,.025,.13],'Paleta mezcladora');tube('guides','steel',[[r*.80,H*.16,0],[r*1.16,H*.16,0],[r*1.16,-.12,0]],.035,'Tubería de salida');}return;
  }
  if(['vibratory-feeder','stock-feeder'].includes(v)){
    base();if(v==='stock-feeder'){for(const z of [-1,1])box('frame','paint',[0,.16,z*W*.40],[L,.24,.08]);for(let i=0;i<5;i++)cylinder('surface','steel',[-L*.30+i*L*.15,.28,0],.05,W*.75,'z',12);box('actuator','accent',[-L*.34,.45,0],[.24,.30,W*.70]);motor([-L*.36,.12,W*.46]);}
    else{const r=Math.min(L*.29,W*.42);cylinder('enclosure','steel',[0,.20,0],r,.30,'y',32,'Cuba vibratoria');ring('guides','steel',[0,.36,0],r*.92,.03,'y');for(const x of [-1,1])for(const z of [-1,1])cylinder('drive','rubber',[x*r*.60,.02,z*r*.60],.05,.16);const points=[];for(let i=0;i<=42;i++){const a=i/42*Math.PI*4;points.push([Math.cos(a)*r*.78,.12+i/42*.22,Math.sin(a)*r*.78]);}tube('guides','steel',points,.015,'Canal helicoidal de alimentación');motor([0,-.20,0]);}return;
  }
  if(['oven','paint-curing','paint-booth','cooling','washer','energy-cutting','additive-printer','welding-cell','welding-source'].includes(v)){
    base();
    if(v==='welding-source'){box('enclosure','paint',[0,.35,0],[L*.5,.70,W*.65]);for(const x of [-1,1])cylinder('frame','rubber',[x*L*.22,F+.12,0],.12,W*.6,'z',16);b.panel([0,.48,W*.34],.48,.28);tube('drive','rubber',[[0,.10,W*.34],[L*.33,F+.13,W*.52],[L*.45,F+.08,W*.62]],.025,'Cable y antorcha');return;}
    table();const rear=-W*.43;box('enclosure','paint',[0,H*.45,rear],[L*.91,H,.08],'Cerramiento posterior');for(const x of [-1,1])box('enclosure','paint',[x*L*.44,H*.45,0],[.08,H,W*.86]);box('enclosure','paint',[0,H-.05,0],[L*.93,.10,W*.93],'Cubierta');
    if(v==='oven'){for(const x of [-1,1]){box('enclosure','accent',[x*L*.22,H*.44,W*.45],[L*.43,H*.96,.08],'Puerta térmica');box('guides','rubber',[x*L*.025,H*.44,W*.497],[.02,H*.70,.02],'Junta de puerta');box('control','steel',[x*L*.075,H*.45,W*.51],[.03,H*.38,.035],'Tirador');}cylinder('utility','steel',[L*.27,H+.18,-W*.20],.10,.35,'y',16,'Conducto de extracción');}
    else if(v==='cooling'){for(const x of [-.25,.25]){cylinder('drive','rubber',[x*L,H*.50,W*.46],.22,.04,'z',20,'Ventilador');for(let j=0;j<6;j++){const a=j*Math.PI/3;beam('drive','steel',[x*L,H*.50,W*.49],[x*L+Math.cos(a)*.20,H*.50+Math.sin(a)*.20,W*.49],.032,'Aspa');}}}
    else if(v==='additive-printer'){guard(L*.82,W*.86,0,H,true);for(const z of [-1,1])box('guides','steel',[0,H*.76,z*W*.30],[L*.70,.025,.025],'Guía X');box('actuator','accent',[0,H*.60,0],[.16,.22,.14],'Extrusor');cone('actuator','steel',[0,H*.46,0],.035,.008,.06);cylinder('drive','plastic',[-L*.33,H*.88,W*.47],.18,.12,'z',24,'Bobina de filamento');tube('drive','rubber',[[-L*.33,H*.96,W*.45],[-L*.2,H*1.08,0],[0,H*.72,0]],.009);}
    else if(v==='energy-cutting'){for(const x of [-1,1])box('guides','steel',[x*L*.37,.20,0],[.06,.08,W*.74]);box('actuator','accent',[0,H*.62,0],[.22,.25,.20]);cone('actuator','steel',[0,H*.44,0],.055,.02,.12);for(let i=0;i<18;i++)box('surface','steel',[-L*.37+i*L*.74/17,.04,0],[.018,.08,W*.74],'Lama de corte');}
    else if(v==='washer'){for(const x of [-1,1]){tube('guides','steel',[[x*L*.28,.07,-W*.33],[x*L*.28,H*.65,-W*.33],[x*L*.28,H*.65,W*.20]],.025,'Colector de lavado');for(const z of [-.22,0,.22])cone('actuator','steel',[x*L*.28,H*.61,z*W],.025,.009,.04);}}
    else if(v==='paint-booth'||v==='paint-curing'){for(let i=0;i<9;i++)box('utility','steel',[0,.12+i*H*.08,rear+.05],[L*.79,.026,.016],'Filtro de extracción');cylinder('utility','steel',[0,H+.18,rear],.17,.34);}
    else guard(L*.85,W*.90,0,H,true);
    return;
  }
  base();table();
  if(v==='cnc-lathe'){
    box('enclosure','paint',[-L*.33,.28,0],[L*.23,.65,W*.72],'Cabezal fijo');const chuck=-L*.17,headFace=-L*.215,back=chuck-.07,spindle=b.moving('spindle','Plato y mordazas sobre el eje real',[chuck,.32,0],{kind:'rotate',axis:'x',turns:12});cylinder(spindle,'steel',[(headFace+back)/2,.32,0],.095,Math.max(.035,back-headFace+.03),'x',20,'Nariz del husillo');cylinder(spindle,'steel',[chuck,.32,0],.19,.14,'x',24,'Plato del torno');for(let i=0;i<3;i++){const a=i*Math.PI*2/3,x=chuck+.098,y=.32+Math.cos(a)*.12,z=Math.sin(a)*.12;box(spindle,'steel',[x,y,z],[.08,.065,.065],'Mordaza del plato');cylinder(spindle,'rubber',[x+.041,y,z],.008,.003,'x',6,'Hueco de fijación de mordaza');}
    box('frame','paint',[L*.31,.15,0],[.24,.30,W*.55],'Contrapunto');const tail=L*.31-.12;cone('actuator','steel',[tail-.10,.32,0],.09,.005,.22,'x','Punto giratorio');box('actuator','accent',[L*.04,.14,W*.20],[.30,.28,.28],'Torreta portaherramientas');cylinder('actuator','steel',[L*.04,.31,W*.20],.13,.06,'y',8,'Torreta indexable');beam('actuator','steel',[L*.04,.32,W*.20],[chuck+.28,.32,.07],.035,'Portaherramienta');box('surface','steel',[chuck+.28,.32,.07],[.035,.018,.035],'Plaquita de corte');for(const z of [-1,1])box('guides','steel',[0,.04,z*W*.28],[L*.78,.06,.06],'Guía de bancada');cylinder('drive','steel',[0,.04,W*.35],.018,L*.72,'x',12,'Husillo de avance');ring('control','steel',[L*.31,.15,W*.30],.09,.012,'z','Volante de contrapunto');tube('drive','rubber',[[-L*.3,.18,-W*.30],[-L*.2,.70,-W*.30],[chuck+.20,.58,.03]],.012,'Línea de refrigerante');guard(L*.86,W*.84,0,H,true);return;
  }
  if(v==='machining-center'||v==='drill-tap'){
    box('frame','paint',[0,H*.48,-W*.30],[L*.30,H,.28],'Columna');box('actuator','accent',[0,H*.72,0],[L*.26,.32,W*.50],'Cabezal del husillo');const spindle=b.moving('spindle','Husillo de mecanizado',[0,H*.43,0],{kind:'rotate',axis:'y',turns:12});cylinder(spindle,'steel',[0,H*.43,0],.075,.28,'y',20,'Husillo');cone(spindle,'steel',[0,H*.25,0],.033,.008,.08);for(const x of [-1,1])box('guides','steel',[x*L*.075,H*.52,-W*.14],[.035,H*.75,.035],'Guías Z');if(v==='machining-center'){guard(L*.88,W*.90,0,H,true);cylinder('drive','steel',[-L*.31,H*.70,0],.18,.045,'y',20,'Carrusel portaherramientas');for(let i=0;i<8;i++){const a=i*Math.PI/4;cylinder('drive','steel',[-L*.31+Math.cos(a)*.15,H*.64,Math.sin(a)*.15],.015,.10);}}return;
  }
  if(v==='press-brake'||v==='stamping-press'){
    for(const x of [-1,1])box('frame','paint',[x*L*.34,H*.45,0],[L*.14,H,W*.68],'Bastidor lateral');box('frame','paint',[0,H,0],[L*.87,.23,W*.70],'Travesaño fijo');
    const slide=component('actuator','Corredera y punzón');slide.userData.equipmentMotion={kind:'linear',axis:'y',min:-.20,max:0};box(slide,'accent',[0,H*.48,0],[L*.69,.21,.20],'Corredera');
    if(v==='press-brake'){box(slide,'steel',[0,H*.32,0],[L*.73,.12,.025],'Punzón lineal');for(const z of [-1,1])box('surface','steel',[0,.05,z*.045],[L*.73,.10,.035],'Matriz V');}else{box(slide,'steel',[0,H*.28,0],[L*.30,.14,W*.36],'Punzón');box('surface','steel',[0,.07,0],[L*.36,.14,W*.42],'Matriz');}
    for(const x of [-1,1])b.actuator('drive',[x*L*.28,H-.08,0],[x*L*.28,H*.50,0],.075);return;
  }
  if(v==='injection-molder'||v==='extruder'){
    const x=-L*.12;cylinder('enclosure','steel',[x,.26,0],.11,L*.58,'x',24,'Camisa plastificadora');for(let i=0;i<6;i++)cylinder('drive','accent',[-L*.33+i*L*.07,.26,0],.13,.08,'x',16,'Banda calefactora');
    cone('guides','steel',[-L*.25,.61,0],.26,.055,.48,'y','Tolva de material');motor([-L*.40,.26,0],'x',1.1);box('frame','steel',[-L*.40,.075,0],[.52,.15,.32],'Soporte del accionamiento');
    if(v==='injection-molder'){box('frame','paint',[L*.13,.33,0],[.12,.65,W*.68],'Platina fija');const platen=b.moving('clamping-platen','Platina movil guiada',[L*.37,.33,0],{kind:'linear',axis:'x',min:0,max:Math.max(.01,Math.min(.08,L*.05-.065))});box(platen,'paint',[L*.37,.33,0],[.12,.65,W*.68],'Platina de cierre');for(const y of [.10,.56])for(const z of [-1,1])cylinder('guides','steel',[L*.25,y,z*W*.25],.022,L*.34,'x',12,'Columna de cierre');box('actuator','steel',[L*.25,.33,0],[L*.12,.34,W*.38],'Molde');}
    else{box('actuator','steel',[L*.30,.26,0],[.16,.26,.26],'Cabezal de extrusión');for(const x2 of [L*.36,L*.44])cylinder('guides','steel',[x2,.23,0],.045,W*.65,'z',12,'Rodillo de salida');}return;
  }
  if(v==='saw'){
    for(const x of [-1,1])box('guides','steel',[x*L*.24,.12,0],[.12,.22,W*.50],'Mordaza de corte');const blade=b.moving('blade','Disco en su eje',[0,.47,0],{kind:'rotate',axis:'z',turns:12});cylinder(blade,'steel',[0,.47,0],.32,.035,'z',32,'Disco de sierra');for(let i=0;i<20;i++){const a=i*Math.PI/10;beam(blade,'steel',[Math.cos(a)*.305,.47+Math.sin(a)*.305,0],[Math.cos(a+.025)*.33,.47+Math.sin(a+.025)*.33,0],.011,'Diente de corte');}ring('enclosure','accent',[0,.47,0],.36,.015,'z','Resguardo de disco');box('frame','paint',[0,.62,-W*.24],[.20,.32,.16]);motor([0,.47,-W*.22],'z',1.2);return;
  }
  if(v==='finishing'){
    for(const x of [-1,1]){cylinder('actuator','rubber',[x*L*.27,.32,0],.24,.12,'x',24,'Muela o disco abrasivo');cylinder('enclosure','paint',[x*L*.27,.32,-.04],.27,.08,'x',24,'Cubre-muela');}motor([0,.32,0],'x',1.7);return;
  }
  if(v==='positioner'){cylinder('actuator','steel',[0,.22,0],Math.min(L,W)*.33,.10,'y',32,'Plato posicionador');motor([0,-.15,0]);return;}
  // Do not silently replace an unknown mechanism with the generic processor.
  throw new Error('No reviewed machine geometry recipe: '+def.id);
}

function transport(b){
 const {box,cylinder,cone,beam,tube,ring,deck,motor,component,layout:l,def}=b,v=def.mechanism,L=l.bodyLength||l.length,W=l.width,F=l.floor,path=l.path&&l.path.points;
 if(v==='roller-pallet'){deck(L,W,0,F,true);for(const z of [-1,1])box('drive','paint',[0,-.30,z*(W*.5+.1)],[L*.98,.20,.10],'Carter de transmisión de rodillos');motor([-L*.32,-.30,W*.65], 'x',1.45);return;}
 if(!Array.isArray(path)||path.length<2)throw new Error('Catalogue transport geometry requires layout.path.points from the shared route.');
 if(v==='telescopic'){
   for(let i=0;i<3;i++){const span=L*(.54-i*.10),x=-L*.20+i*L*.26,y=-i*.035,width=W*(1-i*.12);box('frame',i%2?'accent':'paint',[x,y-.20,0],[span,.30,width+.10],'Cajón telescópico '+(i+1));box('surface','rubber',[x,y-.024,0],[span,.045,width],'Tramo de banda');cylinder('drive','steel',[x+span/2-.03,y-.06,0],.055,width,'z',16);}
   b.feet(L*.45,W,0,F);motor([-L*.33,-.36,W*.60]);return;
 }
 if(v==='screw'){
   const r=W*.32,screw=b.moving('screw','Eje y helice del sinfin',[0,-r*.12,0],{kind:'rotate',axis:'x',turns:4});for(const z of [-1,1])box('frame','paint',[0,-r*.55,z*r],[L,.08,.06],'Canal del sinfín');cylinder(screw,'steel',[0,-r*.12,0],r*.16,L,'x',16,'Eje del tornillo');
   const pts=[];for(let i=0;i<=120;i++){const a=i/120*Math.PI*2*6;pts.push([-L/2+L*i/120,-r*.12+Math.cos(a)*r*.80,Math.sin(a)*r*.80]);}tube(screw,'steel',pts,r*.065,'Hélice del sinfín');for(const x of [-1,1])box('enclosure','paint',[x*L/2,-r*.10,0],[.05,r*1.8,r*2.1]);motor([-L*.45,-r*.13,W*.44]);b.feet(L,W,-r*.3,F);return;
 }
 if(v==='spiral'){
   b.pathDeck(path,W);const rise=path[path.length-1][1];cylinder('frame','paint',[0,(rise+F)/2,0],.12,rise-F,'y',16);for(let i=0;i<path.length;i+=Math.max(1,Math.floor(path.length/8))){const p=path[i];beam('frame','paint',[0,p[1]-.12,0],[p[0],p[1]-.12,p[2]],.07,'Brazo radial de soporte');}return;
 }
 if(v==='bucket-elevator'){
   b.pathDeck(path,W*.65,false);for(const p of [path[0],path[path.length-1]]){cylinder('drive','steel',[p[0],p[1]-.10,p[2]],.10,W*.70,'z',20,'Tambor del elevador');if(p[1]-F>.3)box('frame','paint',[p[0],(p[1]+F)/2,p[2]],[.10,p[1]-F,.10]);}const a=path[1],z=path[path.length-2];for(let i=0;i<9;i++){const t=i/8;box('actuator','accent',[a[0]+(z[0]-a[0])*t,a[1]+(z[1]-a[1])*t+.055,0],[.14,.11,W*.55],'Cangilón');}motor([path[0][0],-.22,W*.35]);return;
 }
 if(v==='pneumatic'){
   tube('enclosure','steel',[[-L*.46,.05,0],[-L*.18,.05,0],[0,.35,0],[L*.1,.75,0],[L*.42,.75,0]],W*.15,'Tubería de transporte');cylinder('drive','paint',[-L*.37,-.16,W*.30],W*.20,.24,'z',20,'Soplante');motor([-L*.37,-.16,W*.50],'z',1.2);for(const x of [-1,1])box('frame','paint',[x*L*.32,F*.5,0],[.05,-F,.05]);return;
 }
 if(v==='overhead'){
   const y=path[0][1];for(const x of [-1,1])for(const z of [-1,1])box('frame','paint',[x*L*.40,(F+y+.30)/2,z*W*.6],[.08,y+.30-F,.08]);box('frame','paint',[0,y+.30,0],[L,.12,.15],'Carril aéreo');for(let i=0;i<5;i++){const x=-L*.40+i*L*.20;cylinder('drive','steel',[x,y+.33,0],.055,.07,'z',12);beam('actuator','steel',[x,y+.25,0],[x,y+.06,0],.018,'Suspensión');ring('surface','steel',[x,y+.015,0],.055,.012,'z','Gancho');}b.root.userData.catalogueSurfacePath=path.map(p=>p.slice());return;
 }
 if(v==='transfer-cart'){deck(L*.72,W,0,F,true);for(const x of [-1,1])box('guides','steel',[x*L*.25,F+.035,0],[.05,.05,W*1.5],'Riel transversal');for(const x of [-1,1])for(const z of [-1,1])cylinder('drive','steel',[x*L*.25,F+.08,z*W*.40],.07,.05,'z',12);motor([0,-.30,W*.55]);return;}
 if(v==='vibratory'){box('surface','steel',[0,-.04,0],[L,.08,W],'Canal vibratorio');for(const z of [-1,1])box('guides','steel',[0,.12,z*W*.5],[L,.30,.025]);for(const x of [-1,1])for(const z of [-1,1]){cylinder('drive','rubber',[x*L*.3,-.22,z*W*.35],.055,.26);box('frame','paint',[x*L*.3,(F-.30)/2,z*W*.35],[.07,-F-.30,.07]);}motor([0,-.36,0]);return;}
 deck(L,W,0,F,v==='slat-chain');motor([-L*.30,-.3,W*.61]);
 if(v==='slat-chain')for(let i=0;i<18;i++)box('surface','steel',[-L*.47+i*L*.94/17,.012,0],[L*.045,.024,W*.98],'Listón portacarga');
 else if(v==='shoe-sorter'){for(let i=0;i<12;i++)box('actuator','accent',[-L*.44+i*L*.88/11,.04,(i%4-1.5)*W*.15],[L*.04,.06,W*.13],'Zapato desviador');}
 else if(v==='crossbelt-sorter'||v==='tilt-tray-sorter'){for(let i=0;i<6;i++){const g=component('actuator-'+i,v==='crossbelt-sorter'?'Cinta transversal':'Bandeja basculante');g.userData.equipmentMotion={kind:v==='tilt-tray-sorter'?'rotate':'belt',axis:'x',min:0,max:.35};box(g,v==='crossbelt-sorter'?'rubber':'steel',[-L*.40+i*L*.80/5,.045,0],[L*.12,.07,W*.88]);}}
 else throw new Error('No reviewed transport geometry recipe: '+def.id);
}

function dock(b){
 const {box,cylinder,beam,deck,motor,actuator,component,layout:l,def}=b,v=def.mechanism,L=l.bodyLength||l.length,W=l.width,F=l.floor;
 if(v==='loading-dock'){box('frame','paint',[0,-.35,0],[L,.7,W]);for(const z of [-1,1])box('guides','rubber',[L*.5,.10,z*W*.40],[.16,.40,.24],'Tope del muelle');for(const z of [-1,1])box('enclosure','rubber',[-L*.26,.92,z*W*.42],[.22,1.84,.20],'Abrigo lateral');box('enclosure','rubber',[-L*.26,1.84,0],[.22,.22,W],'Abrigo superior');return;}
 if(v==='leveler'||v==='tail-lift'||v==='lift-table'){
   const y=v==='tail-lift'?.55:0;box('surface','steel',[0,y-.06,0],[L,.12,W],'Plataforma antideslizante');box('frame','paint',[0,F+.07,0],[L*.8,.14,W*.75]);
   for(const z of [-1,1]){beam('actuator','accent',[-L*.32,F+.15,z*W*.30],[L*.32,y-.14,z*W*.30],.075,'Brazo de tijera');beam('actuator','accent',[L*.32,F+.15,z*W*.30],[-L*.32,y-.14,z*W*.30],.075,'Brazo de tijera');cylinder('actuator','steel',[0,(F+y)/2,z*W*.30],.045,.10,'z',12);actuator('drive',[-L*.28,F+.14,z*W*.25],[L*.14,y-.18,z*W*.25],.045);}
   if(v==='leveler'){box('actuator','steel',[L*.50+.10,y-.035,0],[.20,.07,W],'Labio articulado');cylinder('guides','steel',[L*.50,y-.04,0],.025,W,'z',12,'Bisagra del labio');}return;
 }
 if(v==='restraint'){box('frame','paint',[0,F+.10,0],[L*.55,.20,W*.60]);for(const z of [-1,1])box('guides','accent',[0,F+.30,z*W*.26],[L*.45,.40,.10],'Calzo y carril');beam('actuator','steel',[-L*.18,F+.22,0],[L*.18,F+.65,0],.09,'Gancho retenedor');return;}
 if(v==='atls'){deck(L,W,0,F,true);for(const z of [-.30,0,.30])box('surface','steel',[0,.015,z*W],[L,.03,.13],'Cama de patines de carga');motor([-L*.35,-.28,W*.55]);return;}
 // Marked approach stations are real load-support platforms, without a PLC.
 deck(L,W,0,F,v==='pallet-truck-station');for(const z of [-1,1])box('guides','accent',[0,.003,z*(W*.5-.025)],[L,.006,.035],'Demarcación de apoyo');
}

function picking(b){
 const {box,cylinder,beam,tube,deck,motor,layout:l,def}=b,v=def.mechanism,L=l.bodyLength||l.length,W=l.width,F=l.floor;
 if(['put-wall','pick-to-light'].includes(v)){
   const rows=3,cols=4,H=Math.max(1.3,l.height);for(const x of [-1,1])for(const z of [-1,1])box('frame','paint',[x*L*.50,F+H/2,z*W*.36],[.045,H,.045]);
   for(let row=0;row<=rows;row++)box('surface','steel',[0,F+row*H/rows,0],[L,.025,W*.75],'Entrepaño');for(let col=1;col<cols;col++)box('guides','paint',[-L/2+col*L/cols,F+H/2,0],[.02,H,W*.73],'Divisor');
   for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){const p=[-L*.5+(col+.5)*L/cols,F+(row+1)*H/rows-.035,W*.39];box('sensing','optical',p,[L/cols*.40,.055,.02],'Indicador de picking');cylinder('sensing','green',[p[0]+L/cols*.28,p[1],p[2]+.012],.018,.012,'z',10);}return;
 }
 b.feet(L,W,0,F);box('surface','wood',[0,-.035,0],[L,.07,W],'Mesa ergonómica');
 for(const x of [-1,1])box('frame','aluminum',[x*(L/2-.06),.50,-W*.43],[.05,1,.05],'Montante del puesto');box('frame','aluminum',[0,1,-W*.43],[L,.05,.05],'Barra superior');
 if(v==='voice'){b.panel([L*.26,.42,-W*.28],.38,.28);tube('control','rubber',[[0,.12,0],[.08,.28,.02],[.20,.29,.02]],.01,'Micrófono del puesto');}
 else if(v==='goods-to-person'||v==='goods-to-robot'){deck(L*.75,W*.48,.03,F,false);for(const z of [-1,1])box('guides','accent',[0,.20,z*W*.28],[L*.75,.05,.03]);b.sensor([-L*.3,.20,W*.3]);}
 else{for(let i=0;i<3;i++)box('guides','plastic',[-L*.28+i*L*.28,.13,-W*.25],[L*.23,.26,W*.28],'Contenedor del puesto');if(v==='packing-bench')cylinder('guides','cardboard',[0,.55,-W*.35],.15,L*.70,'x',20,'Rollo de embalaje');}
}

function storage(b){
 const {box,cylinder,beam,deck,motor,component,layout:l,def}=b,v=def.mechanism,L=l.bodyLength||l.length,W=l.width,F=l.floor,H=Math.max(1,l.height);
 if(v==='reject-bin'){box('surface','plastic',[0,F+.025,0],[L,.05,W]);for(const z of [-1,1])box('enclosure','plastic',[0,F+H*.35,z*W*.5],[L,H*.7,.035]);for(const x of [-1,1])box('enclosure','plastic',[x*L*.5,F+H*.35,0],[.035,H*.7,W]);for(const x of [-1,1])for(const z of [-1,1])cylinder('frame','rubber',[x*L*.37,F+.06,z*W*.37],.06,.04,'z',12);return;}
 const cols=v==='cube'?4:3,rows=v==='cube'?4:2;for(const x of [-1,1])for(const z of [-1,1])box('frame','paint',[x*L*.50,F+H/2,z*W*.50],[.06,H,.06]);
 for(let y=0;y<=rows;y++){const top=F+.12+y*(H-.20)/rows;for(const z of [-1,1])box('frame','accent',[0,top-.035,z*W*.50],[L,.07,.05]);for(let col=0;col<cols;col++){const x=-L/2+(col+.5)*L/cols;box('surface','steel',[x,top-.01,0],[L/cols-.05,.02,W*.90],'Apoyo de almacenamiento');}}
 if(['pallet-asrs','multilevel-shuttle','automatic-pallet-shuttle','pallet-shuttle','cube','carousel'].includes(v)){
   const mover=component('actuator','Extractor o lanzadera');mover.userData.equipmentMotion={kind:'linear',axis:v==='pallet-asrs'?'y':'x',min:0,max:v==='pallet-asrs'?H-.5:L*.6};
   if(v==='pallet-asrs'){box('guides','steel',[0,F+H*.5,W*.60],[.15,H,.12],'Mástil del transelevador');box(mover,'accent',[0,F+.38,W*.60],[L*.40,.16,W*.45],'Carro extractor');}
   else if(v==='carousel'){cylinder('drive','steel',[0,F+H*.5,0],.08,H,'y',16);for(let i=0;i<8;i++){const a=i*Math.PI/4;box(mover,'plastic',[Math.cos(a)*L*.29,F+.4,Math.sin(a)*W*.35],[L*.18,.18,W*.23],'Bandeja de carrusel');}}
   else{box(mover,'accent',[0,F+.25,0],[L*.23,.15,W*.65],'Shuttle');for(const x of [-1,1])for(const z of [-1,1])cylinder(mover,'rubber',[x*L*.09,F+.21,z*W*.33],.04,.03,'z',10);}
   motor([L*.35,F+.17,W*.60]);
 }
}

function product(b){
 const {box,cylinder,cone,beam,ring,layout:l,def}=b,v=def.mechanism,L=l.bodyLength||l.length,W=l.width,H=l.height;
 if(v==='metal-pallet'){for(const z of [-1,0,1]){box('surface','steel',[0,H*.83,z*W*.30],[L,H*.12,W*.23]);for(const x of [-1,1])box('frame','steel',[x*L*.35,H*.38,z*W*.30],[L*.15,H*.60,W*.19]);}for(const x of [-1,1])box('frame','steel',[x*L*.35,H*.07,0],[L*.20,H*.14,W]);return;}
 if(v==='slip-sheet'){box('surface','plastic',[0,H*.015,0],[L,Math.min(.006,H*.04),W],'Lámina de carga');box('guides','plastic',[L*.53,H*.022,0],[L*.08,.005,W],'Pestaña de arrastre');return;}
 if(v==='ibc'){box('enclosure','plastic',[0,H*.48,0],[L*.89,H*.83,W*.88],'Depósito IBC');for(const x of [-1,1])for(const z of [-1,1])box('frame','steel',[x*L*.47,H*.49,z*W*.47],[.018,H*.90,.018]);for(let i=0;i<4;i++){const y=H*.12+i*H*.25;for(const z of [-1,1])box('frame','steel',[0,y,z*W*.47],[L*.96,.014,.014]);for(const x of [-1,1])box('frame','steel',[x*L*.47,y,0],[.014,.014,W*.96]);}box('surface','steel',[0,H*.035,0],[L,.07*H,W]);cylinder('guides','plastic',[0,H*.93,0],Math.min(L,W)*.13,H*.04);cylinder('actuator','plastic',[0,H*.10,W*.48],.04,.09,'z',12,'Válvula de salida');return;}
 if(v==='long-stock'){for(let i=0;i<5;i++)cylinder('surface','steel',[0,H*.16+Math.floor(i/3)*H*.28,(i%3-1)*W*.24],Math.min(H*.12,W*.10),L,'x',12,'Perfil largo');return;}
 if(v==='bulk-fluid'){cylinder('enclosure','plastic',[0,H*.43,0],Math.min(L,W)*.40,H*.80,'y',24,'Recipiente a granel');cylinder('surface','glass',[0,H*.77,0],Math.min(L,W)*.37,.006,'y',24,'Nivel de contenido');return;}
 // Oversize/conditioned stock is a reinforced crate, not a cardboard cube.
 box('enclosure','wood',[0,H*.50,0],[L,H,W]);for(const x of [-1,1])for(const z of [-1,1])box('frame','steel',[x*L*.46,H*.50,z*W*.46],[.025,H,.025]);for(const y of [.10,.90])for(const z of [-1,1])box('frame','steel',[0,H*y,z*W*.505],[L,.025,.012]);
}

function sensorUtility(b){
 const {box,cylinder,cone,beam,tube,ring,deck,motor,panel,layout:l,def}=b,v=def.mechanism,L=l.bodyLength||l.length,W=l.width,F=l.floor,H=l.height;
 if(['checkweigher','weigh-dimension','platform-scale','dimensioner'].includes(v)){
   if(v==='platform-scale'){box('frame','paint',[0,F+.035,0],[L,.07,W]);box('surface','steel',[0,F+.09,0],[L*.97,.04,W*.97]);for(const x of [-1,1])for(const z of [-1,1])cylinder('sensing','rubber',[x*L*.35,F+.045,z*W*.35],.045,.05);}
   else{deck(L,W,0,F,false);if(v==='checkweigher'){box('sensing','steel',[0,-.10,0],[L*.38,.07,W*.70],'Célula de carga');box('surface','rubber',[0,.025,0],[L*.35,.04,W*.92],'Banda de pesaje aislada');}}
   if(v!=='checkweigher'&&v!=='platform-scale'){for(const z of [-1,1])box('frame','aluminum',[0,H*.5,z*W*.55],[.07,H,.07]);box('frame','aluminum',[0,H,0],[.07,.07,W*1.17]);for(const z of [-1,0,1])box('sensing','optical',[0,H-.10,z*W*.40],[.12,.10,.12],'Sensor de dimensión');}
   box('frame','paint',[L*.38,.45,W*.65],[.045,.9,.045]);panel([L*.38,.85,W*.65],.32,.22);return;
 }
 if(def.role==='safety'){
   if(v==='guard'){const high=Math.max(1.2,H),floor=F;for(const x of [-1,1])box('frame','accent',[x*L*.5,floor+high*.5,0],[.045,high,.045]);for(const y of [.10,high-.1])box('frame','paint',[0,floor+y,0],[L,.035,.035]);for(let i=0;i<14;i++)box('enclosure','steel',[-L*.47+i*L*.94/13,floor+high*.5,0],[.007,high-.20,.007]);for(let i=0;i<7;i++)box('enclosure','steel',[0,floor+.13+i*(high-.26)/6,0],[L,.007,.007]);}
   else{for(const x of [-1,1]){box('frame','accent',[x*L*.5,F+H*.5,0],[.06,H,.06]);box('sensing','optical',[x*L*.5,F+H*.5,.035],[.03,H*.85,.012],'Barrera óptica');}if(v==='emergency-rearm')panel([0,F+H*.65,.05],.25,.30);}return;
 }
 if(def.role==='utility'){
   if(v==='extraction'){cylinder('enclosure','paint',[0,F+H*.53,0],Math.min(L,W)*.34,H*.75,'y',24,'Colector filtrante');cone('enclosure','steel',[0,F+H*.14,0],Math.min(L,W)*.34,.05,H*.22);cylinder('drive','paint',[0,F+H*.92,0],Math.min(L,W)*.23,H*.16);tube('guides','steel',[[0,F+H*.90,0],[L*.45,F+H*.90,0],[L*.45,F+H*.35,0]],.08,'Conducto');b.feet(L*.7,W*.7,F+H*.2,F);}
   else if(v==='energy'){cylinder('enclosure','paint',[0,F+H*.30,0],W*.34,L*.80,'x',24,'Depósito de aire');motor([0,F+H*.63,0],'x',1.3);for(const x of [-1,1])box('frame','steel',[x*L*.3,F+.08,0],[.09,.16,W*.55]);tube('guides','rubber',[[L*.15,F+H*.50,0],[L*.28,F+H*.76,0],[L*.36,F+H*.74,0]],.014,'Manguera');}
   else{box('frame','paint',[0,F+.04,0],[L*.75,.08,W*.72]);if(v==='fluid-actuator')b.actuator('actuator',[-L*.34,F+H*.40,0],[L*.36,F+H*.40,0],W*.12);else motor([0,F+H*.24,0],'x',Math.min(L,H)*1.3);}return;
 }
 if(def.role==='control'&&v==='charging-station'){box('enclosure','paint',[0,F+H*.5,0],[L,H,W]);panel([0,F+H*.67,W*.51],L*.70,H*.27);for(const x of [-1,1])tube('drive','rubber',[[x*L*.30,F+H*.50,W*.5],[x*L*.48,F+.12,W*.7],[x*L*.18,F+.16,W*.75]],.018,'Cable de carga');return;}
 if(['barcode-rf','barcode-rfid','rfid-portal','vision-distance'].includes(v)){
   if(v==='barcode-rf'){box('enclosure','plastic',[0,H*.4,0],[L*.65,H*.65,W]);box('sensing','optical',[0,H*.65,W*.52],[L*.45,H*.24,.015]);beam('frame','plastic',[0,H*.18,0],[0,-H*.35,-W*.15],L*.20,'Empuñadura');}
   else{for(const x of [-1,1])box('frame','aluminum',[x*L*.45,F+H*.50,0],[.035,H,.035]);box('frame','aluminum',[0,F+H,0],[L,.035,.035]);for(const x of [-1,0,1])box('sensing','optical',[x*L*.32,F+H*.75,.07],[.12,.16,.06]);}return;
 }
 if(v==='inductive-capacitive'){cylinder('enclosure','steel',[0,0,0],Math.min(L,W)*.3,H*.65,'y',16,'Cuerpo roscado');cylinder('sensing','plastic',[0,H*.34,0],Math.min(L,W)*.3,.015);for(const y of [-H*.2,0])cylinder('frame','steel',[0,y,0],Math.min(L,W)*.40,.015,'y',6,'Tuerca de montaje');tube('drive','rubber',[[0,-H*.33,0],[0,-H*.55,.08],[L*.45,-H*.60,.08]],.008);return;}
 if(v==='encoder-limit'){cylinder('enclosure','paint',[0,0,0],W*.43,H*.5,'y',20,'Encoder');cylinder('actuator','steel',[0,H*.35,0],.018,H*.28);box('sensing','plastic',[L*.3,0,0],[.07,.10,.06],'Final de carrera');return;}
 if(['process','load-pressure','condition'].includes(v)){cylinder('enclosure','steel',[0,H*.22,0],W*.45,.06,'z',20,'Instrumento');cylinder('sensing','optical',[0,H*.22,.035],W*.35,.005,'z',20,'Esfera de medida');beam('sensing','red',[0,H*.22,.042],[W*.2,H*.37,.042],.007,'Aguja');cylinder('frame','steel',[0,0,0],.025,H*.25,'y',12,'Toma de proceso');return;}
 // Photoelectric sensor pair has a real bracket, cable and optical axis.
 for(const x of [-1,1]){box('frame','steel',[x*L*.5,F+H*.35,0],[.025,H*.70,.04]);box('sensing','plastic',[x*L*.5,F+H*.70,0],[.06,.09,.06]);cylinder('sensing','optical',[x*L*.5,F+H*.70,.034],.02,.008,'z',12);}
}

function tool(b){
 const {box,cylinder,cone,beam,tube,ring,component,def,layout:l}=b,v=def.mechanism,L=Math.max(.12,l.length),W=Math.max(.10,l.width),H=Math.max(.10,l.height);
 if(v==='stand'){const deckTop=Math.max(.2,H-.13);b.feet(L,W,deckTop,0);box('surface','steel',[0,deckTop-.035,0],[L,.07,W],'Mesa de cambio de herramientas');for(const x of [-1,1]){cylinder('guides','plastic',[x*L*.24,deckTop+.018,0],Math.min(L,W)*.12,.036,'y',16,'Nido de estacionamiento EOAT');for(const z of [-1,1])cylinder('guides','steel',[x*L*.24,deckTop+.07,z*W*.08],.009,.11,'y',10,'Pasador de posicionamiento');}return;}
 const depth=/vacuum/.test(v)?H*.68+.0225:v==='layer-gripper'?H*.57+.0015:v==='magnet'?H*.455:v==='needle'?H*.79:/side-clamp|sack-gripper|drum-gripper/.test(v)?H*.79:v==='force-torque'?H*.32:v==='changer'?H*.34:/camera|probe/.test(v)?H*.62:v==='spot-welder'?H*.66:/welder|weld|paint-spray|adhesive|spindle|screwdriver|cutter/.test(v)?(/spindle|cutter/.test(v)?H*.75+.01:H*.88):H*.78+.025;
 b.root.userData.robotCatalogueToolFrame={flange:[0,0,0],contact:[0,-depth,v==='spot-welder'?W*.26:0],approach:[0,-1,0],style:def.toolType==='process'?'process':def.toolType==='fork'?'support':def.toolType==='vacuum'||['magnet','needle'].includes(v)?'top':'side',mechanism:v};
 cylinder('frame','steel',[0,0,0],Math.min(L,W)*.27,.035,'y',20,'Brida de montaje');for(let i=0;i<4;i++){const a=i*Math.PI/2;b.bolt('frame',[Math.cos(a)*Math.min(L,W)*.19,.022,Math.sin(a)*Math.min(L,W)*.19]);}
 cylinder('frame','steel',[0,-H*.12,0],Math.min(L,W)*.20,H*.24,'y',16,'Adaptador conectado a la brida');
 if(/vacuum|layer/.test(v)){box('frame','aluminum',[0,-H*.25,0],[L,.045,W]);if(v==='layer-gripper'){box('surface','rubber',[0,-H*.47,0],[L*.96,H*.18,W*.96],'Espuma de área de vacío');for(let i=0;i<6;i++)for(let j=0;j<4;j++)cylinder('surface','optical',[(i-2.5)*L*.14,-H*.57,(j-1.5)*W*.21],.005,.003,'y',6,'Puerto de área');tube('drive','rubber',[[0,-H*.28,0],[0,-H*.10,W*.20],[0,.06,0]],.016,'Colector de vacío');return;}const n=v==='vacuum-single'?1:2;for(let i=0;i<n;i++)for(let j=0;j<n;j++){const x=n===1?0:(i-.5)*L*.65,z=n===1?0:(j-.5)*W*.65;cylinder('actuator','steel',[x,-H*.48,z],.012,H*.35);cone('surface','rubber',[x,-H*.68,z],.022,.045,.045);tube('drive','rubber',[[x,-H*.28,z],[x,-H*.12,z],[0,.035,0]],.005,'Línea de vacío');}return;}
 if(v==='forks'||v==='forklift-attachment'){box('frame','paint',[0,-H*.34,0],[L,.20*H,.055]);for(const x of [-1,1]){box('actuator','steel',[x*L*.28,-H*.50,W*.35],[.045,H*.08,W*.90]);box('actuator','steel',[x*L*.28,-H*.28,-W*.08],[.045,H*.50,.035]);}return;}
 if(v==='magnet'){cylinder('actuator','paint',[0,-H*.25,0],Math.min(L,W)*.42,H*.30,'y',24,'Electroimán');cylinder('surface','steel',[0,-H*.43,0],Math.min(L,W)*.43,H*.05,'y',24,'Cara polar');tube('drive','rubber',[[W*.20,-H*.25,0],[W*.30,.02,.02],[W*.10,.08,0]],.007,'Alimentación del electroimán');return;}
 if(v==='needle'){box('actuator','paint',[0,-H*.30,0],[L*.85,H*.35,W*.80]);for(const x of [-1,0,1])for(const z of [-1,1])beam('surface','steel',[x*L*.25,-H*.45,z*W*.22],[x*L*.25+L*.06,-H*.79,z*W*.12],.005,'Aguja de sujeción');return;}
 if(v==='side-clamp'||v==='sack-gripper'||v==='drum-gripper'){
   box('actuator','paint',[0,-H*.20,0],[L,H*.22,W*.40]);const rail=component('jaw-guide','Guia extensible de mordazas');rail.userData.catalogueJawGuide=true;box(rail,'steel',[0,-H*.25,0],[1,.035,.045],'Guia lineal de mordazas');
   for(const x of [-1,1]){const jaw=component('finger-'+x,'Mordaza independiente '+x),contact=component('contact-pad','Contacto de mordaza '+x,jaw);jaw.userData.catalogueFinger={direction:[x,0],radius:(v==='drum-gripper'?L*.16:L*.27)/.86,padHalf:v==='drum-gripper'?.022:.0125};cylinder(jaw,'steel',[x*L*.38,-H*.25,0],.025,W*.48,'z',12,'Eje de mordaza');beam(jaw,'steel',[x*L*.38,-H*.25,0],[x*L*.34,-H*.67,0],.035,'Brazo articulado');
     if(v==='drum-gripper'){const points=[];for(let i=0;i<=10;i++){const a=-Math.PI*.35+i/10*Math.PI*.70;points.push([x*(L*.30-Math.cos(a)*L*.14),-H*.68,Math.sin(a)*W*.40]);}tube(contact,'rubber',points,.022,'Mordaza curva de tambor');}
     else box(contact,v==='sack-gripper'?'rubber':'steel',[x*L*.27,-H*.67,0],[.025,H*.24,W*.75],'Mordaza lateral');}return;
 }
 if(v==='spot-welder'){
   beam('frame','paint',[0,-H*.12,0],[0,-H*.20,-W*.30],L*.25);beam('frame','paint',[0,-H*.20,-W*.30],[0,-H*.75,-W*.30],L*.25);beam('frame','paint',[0,-H*.75,-W*.30],[0,-H*.75,W*.26],L*.22,'Brazo C');b.actuator('actuator',[0,-H*.22,W*.26],[0,-H*.55,W*.26],L*.12);cone('surface','steel',[0,-H*.62,W*.26],L*.08,.007,H*.08);cone('surface','steel',[0,-H*.71,W*.26],.007,L*.08,H*.06);return;
 }
 if(/welder|weld|paint-spray|adhesive|spindle|screwdriver|cutter/.test(v)){cylinder('drive','paint',[0,-H*.25,0],W*.26,H*.40,'y',20,'Cuerpo del útil');cylinder('actuator','steel',[0,-H*.55,0],W*.13,H*.28,'y',12,'Adaptador');if(/spindle|cutter/.test(v))cylinder('surface','rubber',[0,-H*.75,0],W*.38,.02,'y',24,'Disco');else cone('surface','steel',[0,-H*.78,0],W*.12,.008,H*.20);tube('drive','rubber',[[0,-H*.30,W*.25],[W*.30,-H*.10,W*.20],[W*.20,.07,0]],.008,'Servicio de herramienta');return;}
 if(v==='force-torque'){cylinder('frame','steel',[0,-H*.09,0],W*.38,H*.08,'y',24,'Brida de celda de carga');cylinder('sensing','plastic',[0,-H*.20,0],W*.32,H*.17,'y',20,'Transductor de fuerza y par');cylinder('surface','steel',[0,-H*.30,0],W*.38,H*.04,'y',24,'Brida de salida');tube('drive','rubber',[[W*.30,-H*.20,0],[W*.46,-H*.15,.02],[W*.40,.03,.02]],.006,'Cable de medida');return;}
 if(/camera|probe/.test(v)){box('enclosure','paint',[0,-H*.27,0],[L*.70,H*.50,W*.70]);if(v==='probe'){cylinder('sensing','steel',[0,-H*.53,0],.006,H*.14,'y',12,'Vastago de palpador');cylinder('surface','red',[0,-H*.61,0],.008,.008,'y',12,'Bola de palpado');}else{cylinder('sensing','optical',[0,-H*.56,0],W*.20,H*.12,'y',16,'Objetivo de camara');for(const x of [-1,1])box('sensing','optical',[x*L*.23,-H*.52,0],[L*.12,.008,W*.65],'Iluminacion de inspeccion');}return;}
 if(v==='changer'||v==='changer-stand'){b.root.userData.robotCatalogueToolFrame.contact=[0,-H*.34,0];for(const y of [-H*.12,-H*.28]){cylinder('frame','steel',[0,y,0],W*.40,H*.12,'y',24,'Placa de acoplamiento');for(let i=0;i<6;i++){const a=i*Math.PI/3;cylinder('actuator','steel',[Math.cos(a)*W*.33,-H*.20,Math.sin(a)*W*.33],.009,H*.10,'y',10,'Pasador de cierre');}}return;}
 if(/stand/.test(v)){box('surface','steel',[0,-H*.17,0],[L,.06,W]);for(const x of [-1,1])box('frame','paint',[x*L*.35,-H*.6,0],[.035,H*.80,.035]);return;}
 const n=/three-finger|soft-gripper/.test(v)?3:v==='double-gripper'?4:2;box('enclosure','paint',[0,-H*.22,0],[L*.65,H*.30,W*.65],'Actuador de la pinza');
 for(let index=0;index<(n===3?3:n===4?2:1);index++){const guide=component('jaw-guide-'+index,'Guia extensible de los dedos');guide.userData.catalogueJawGuide=n===3?'radial':'diameter';if(n===3)guide.rotation.y=-index*Math.PI*2/3;box(guide,'steel',[n===3?.5:0,-H*.30,n===4?(index?1:-1)*W*.28:0],[1,.035,.045],'Guia lineal de mordazas');}
 for(let i=0;i<n;i++){
  const a=v==='double-gripper'?(i%2)*Math.PI:n===2?i*Math.PI:i*Math.PI*2/n,r=n===3?Math.min(L,W)*.28:L*.28,x=Math.cos(a)*r,z=v==='double-gripper'?(i<2?-1:1)*W*.28:Math.sin(a)*r,finger=component('finger-'+i,'Dedo independiente '+(i+1));
  finger.userData.catalogueFinger={direction:[Math.cos(a),v==='double-gripper'?0:Math.sin(a)],radius:r,padHalf:Math.min(L,W)*.09};
  if(/soft|adaptive/.test(v))tube(finger,'rubber',[[x,-H*.30,z],[x*.95,-H*.48,z*.96],[x*.76,-H*.68,z*.80],[x*.86,-H*.78,z*.86]],Math.min(L,W)*.065,'Dedo flexible segmentado');
  else{beam(finger,'steel',[x,-H*.30,z],[x,-H*.77,z],Math.min(L,W)*.12,'Dedo de pinza');if(v==='angular-gripper')cylinder(finger,'steel',[x,-H*.32,z],.025,.04,'z',12,'Pivote de dedo angular');}
  const pad=component('contact-pad','Superficie de contacto de dedo '+(i+1),finger);box(pad,/soft|adaptive/.test(v)?'rubber':'steel',[x*.86,-H*.78,z*.86],[Math.min(L,W)*.18,.05,Math.min(L,W)*.18],'Punta de contacto');
 }
}

function carrier(b){
 const {box,cylinder,beam,tube,ring,motor,component,layout:l,def}=b,v=def.mechanism,L=l.bodyLength||l.length,W=l.width,F=l.floor,H=l.height;
 if(v==='overhead-crane'||v==='ergonomic-manipulator'){
   const span=L*.84;for(const x of [-1,1])for(const z of [-1,1])box('frame','paint',[x*span/2,F+H/2,z*W*.44],[.12,H,.12],'Columna del pórtico');for(const z of [-1,1])box('frame','accent',[0,F+H,z*W*.44],[L,.18,.12],'Viga carril');box('actuator','accent',[0,F+H,0],[.20,.16,W],'Puente');cylinder('drive','paint',[0,F+H-.10,0],.10,.25,'x',20,'Polipasto');tube('actuator','steel',[[0,F+H-.18,0],[0,F+H*.45,0]],.009,'Cable de izado');ring('surface','steel',[0,F+H*.40,0],.09,.025,'z','Gancho');return;
 }
 if(v==='inventory-drone'){box('frame','plastic',[0,H*.4,0],[L*.35,H*.2,W*.35]);for(const x of [-1,1])for(const z of [-1,1]){beam('frame','paint',[0,H*.4,0],[x*L*.37,H*.4,z*W*.37],.025);cylinder('drive','steel',[x*L*.37,H*.43,z*W*.37],.035,.06);box('actuator','plastic',[x*L*.37,H*.47,z*W*.37],[L*.30,.009,.018]);}return;}
 if(v==='freight-truck'){
   box('frame','steel',[0,F+H*.18,0],[L*.95,.16,W*.78],'Chasis del camión');box('enclosure','paint',[-L*.30,F+H*.47,0],[L*.27,H*.70,W*.90],'Cabina');box('enclosure','optical',[-L*.44,F+H*.66,0],[.018,H*.20,W*.74],'Parabrisas');box('surface','paint',[L*.17,F+H*.34,0],[L*.60,H*.06,W*.94],'Caja de carga');for(const x of [-L*.30,L*.19,L*.35])for(const z of [-1,1]){cylinder('drive','rubber',[x,F+H*.16,z*W*.44],H*.16,W*.13,'z',20,'Neumático');cylinder('drive','steel',[x,F+H*.16,z*W*.51],H*.08,.012,'z',12,'Llanta');}return;
 }
 // Side loader's payload platform and side mast differ from a forklift front.
 box('frame','paint',[0,F+.17,0],[L,.34,W],'Chasis lateral');for(const x of [-1,1])for(const z of [-1,1])cylinder('drive','rubber',[x*L*.36,F+.18,z*W*.47],.18,.10,'z',16);
 box('surface','steel',[0,F+.36,W*.20],[L*.80,.04,W*.45]);box('frame','paint',[0,F+H*.54,-W*.34],[.14,H,.14]);box('actuator','accent',[0,F+.66,0],[.18,.12,W*.74]);
}

function createEquipmentGeometry(def,cfg,deps={}){
 if(!def||!cfg||!deps.THREE)throw new Error('Equipment geometry requires a definition, normalized configuration and THREE.');
 if(keepNative(def)||def.role==='monitor')return null;
 if(!deps.layout)throw new Error('Geometry must use the authoritative catalogue layout.');
 const b=builder(deps.THREE,def,cfg,deps.layout),family=def.geometryFamily||def.role;
 if(family==='packaging')packaging(b);else if(family==='machine')machine(b);else if(family==='transport')transport(b);else if(family==='dock')dock(b);else if(family==='picking')picking(b);else if(family==='storage')storage(b);else if(family==='product')product(b);else if(family==='tool')tool(b);else if(['sensor','utility','safety','control'].includes(family))sensorUtility(b);else if(['vehicle','mobile'].includes(family))carrier(b);else throw new Error('Unsupported equipment geometry family: '+family);
 if(def.nativeKind==='processor'&&deps.layout.bodyLength)processorBuffers(b);
 return b.finish();
}


function processorBuffers(b){
 const l=b.layout,width=l.bufferWidth||Math.min(l.width,1.2),length=l.bufferLength||1.1;
 for(const [label,position]of [['Entrada',l.inputPosition],['Salida',l.outputPosition]]){
  if(!position)continue;const [x,y,z]=position;
  b.box('surface','steel',[x,y-.035,z],[length,.07,width],'Apoyo de buffer '+label);
  for(const sign of [-1,1]){
   b.box('frame','paint',[x,y-.12,z+sign*(width/2+.015)],[length,.16,.04],'Larguero de buffer');
   for(const sx of [-1,1]){const px=x+sx*(length/2-.10),pz=z+sign*(width/2-.06),height=y-l.floor-.13;b.box('frame','paint',[px,l.floor+height/2,pz],[.045,height,.045],'Pata tubular');b.cylinder('frame','rubber',[px,l.floor+.014,pz],.045,.028);}
  }
  const anchors=b.root.userData.industrialStickerAnchors||(b.root.userData.industrialStickerAnchors=[]);
  // These anchors project onto the existing outer beam face in FinishSystem.
  // No opaque sign plane, duplicate casing or additional collision is inserted.
  anchors.push({id:label==='Entrada'?'equipment-id':'warning-pinch',position:[x,y-.12,z+width/2+.035],normal:[0,0,1],size:[Math.min(.25,length*.55),.055]});
  b.root.userData.catalogueBufferSupports=b.root.userData.catalogueBufferSupports||[];b.root.userData.catalogueBufferSupports.push({position:position.slice(),length,width});
 }
}

const motionCache=new WeakMap();
const attachedBodies=new WeakMap();
/** Presentation follows the real processor cycle. No timer, new load custody,
 * fabricated machine status, or translation of the entire housing is added.
 * Paused, stopped, operator-wait and emergency poses remain where they stopped.
 * Dynamic jaws/presses are educational bounded strokes, not cutting physics. */
function animateEquipment(root,state={}){
 if(!root)return 0;
 let body=root.userData.catalogueGeometryBody?root:attachedBodies.get(root);
 if(body&&body!==root){let parent=body.parent;while(parent&&parent!==root)parent=parent.parent;if(parent!==root)body=null;}
 if(!body){root.traverse(node=>{if(!body&&node.userData.catalogueGeometryBody)body=node;});if(body)attachedBodies.set(root,body);}
 if(!body)return 0;
 let entries=motionCache.get(body);
 if(!entries){entries=[];body.traverse(node=>{if(node.userData.equipmentMotion)entries.push({node,position:node.position.clone(),quaternion:node.quaternion.clone(),motion:Object.assign({},node.userData.equipmentMotion)});});motionCache.set(body,entries);}
 if(state.editing){entries.forEach(entry=>{entry.node.position.copy(entry.position);entry.node.quaternion.copy(entry.quaternion);});body.updateMatrixWorld(true);return entries.length;}
 const active=state.enabled!==false&&state.powered!==false&&!!state.running&&!state.paused&&!state.emergency&&!!state.busy&&!state.settingUp&&!state.waitingOperator;
 if(!active)return 0;
 const progress=clamp(finite(state.progress,0)/100,0,1),stroke=(1-Math.cos(progress*Math.PI*2))/2;
 entries.forEach(entry=>{
  const {node,motion,position,quaternion}=entry,axis=['x','y','z'].includes(motion.axis)?motion.axis:'y';node.position.copy(position);node.quaternion.copy(quaternion);
  if(motion.kind==='linear'){const min=finite(motion.min,0),max=finite(motion.max,0);node.position[axis]+=(Math.abs(min)>Math.abs(max)?min:max)*stroke;}
  else if(motion.kind==='rotate'){
   const angle=motion.turns===undefined?finite(motion.min,0)+(finite(motion.max,0)-finite(motion.min,0))*stroke:progress*Math.PI*2*motion.turns;
   const unit=node.position.clone().set(0,0,0);unit[axis]=1;const delta=node.quaternion.clone().setFromAxisAngle(unit,angle);node.quaternion.copy(quaternion).multiply(delta);
  }
 });
 body.updateMatrixWorld(true);return entries.length;
}

function disposeGeometry(root){const all=new Set();root.traverse(n=>{if(n.geometry)all.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:n.material?[n.material]:[]){all.add(m);for(const t of Object.values(m))if(t&&t.isTexture)all.add(t);}});all.forEach(item=>item.dispose());}

/** The storage runtime owns all poses and occupancy. These two visuals consume
 * its exact cells and access point; they are not aliases for a miniload. */
function createCatalogueStorageVisual(THREE,cfg,layout){
 const mechanism=layout.definition&&layout.definition.mechanism;
 if(!['cube','carousel'].includes(mechanism))throw new Error('This storage geometry needs a cube or horizontal carousel layout.');
 const def={id:'equipment.storage.'+mechanism,title:mechanism==='cube'?'Almacenamiento cúbico con extractor superior':'Carrusel horizontal de bandejas',role:'storage',geometryFamily:'storage',geometryVariant:mechanism,operationLevel:'addressed-storage'};
 const c={frameColor:cfg.rackFrameColor||'#466574',accentColor:cfg.rackBeamColor||'#d49b3d',wear:.1},b=builder(THREE,def,c,layout),cells=layout.cells||[],rig={system:cfg.rackSystem,pallets:[],banks:[],supports:[],carriage:null,lift:null,shuttle:null,carouselTrays:[]};
 const root=b.root;Object.defineProperty(root.userData,'warehouseRackRig',{value:rig,writable:true,configurable:true,enumerable:false});
 const marker=cell=>{const g=new THREE.Group();g.name='Ubicación '+cell.code;g.position.fromArray(cell.position);Object.assign(g.userData,{warehouseRackCell:cell.index,warehouseRackLocationCode:cell.code,editorNonCollidable:true});root.add(g);rig.pallets[cell.index]={object:g,config:{width:cell.width,depth:cell.depth,top:0},items:[],cell};rig.supports.push({index:cell.index,position:cell.position.slice(),width:cell.width,depth:cell.depth});};
 let sync=()=>{};
 if(mechanism==='cube'){
   const floor=layout.floor,top=layout.motion.topY,guideTop=finite(layout.motion.guideTopY,top-.15),columns=new Map();cells.forEach(cell=>{const key=cell.lane||cell.position[0]+':'+cell.position[2];if(!columns.has(key)||columns.get(key).level>cell.level)columns.set(key,cell);});
   const xs=cells.map(cell=>cell.position[0]-cell.width/2),xe=cells.map(cell=>cell.position[0]+cell.width/2),zs=cells.map(cell=>cell.position[2]-cell.depth/2),ze=cells.map(cell=>cell.position[2]+cell.depth/2),minX=Math.min(...xs)-.07,maxX=Math.max(...xe)+.07,minZ=Math.min(...zs)-.07,maxZ=Math.max(Math.max(...ze)+.07,layout.accessPosition[2]+.15),base=Math.min(...cells.map(cell=>cell.position[1]));
   const guidePoints=new Map();columns.forEach(cell=>{for(const x of [-1,1])for(const z of [-1,1]){const px=cell.position[0]+x*(cell.width/2+.025),pz=cell.position[2]+z*(cell.depth/2+.025);guidePoints.set(px.toFixed(5)+':'+pz.toFixed(5),[px,pz]);}
     b.box('surface','steel',[cell.position[0],base-.035,cell.position[2]],[cell.width+.07,.07,cell.depth+.07],'Apoyo inferior de pila');
   });
   guidePoints.forEach(p=>b.box('frame','aluminum',[p[0],(base+guideTop)/2,p[1]],[.025,guideTop-base,.025],'Guía vertical de columna'));
   for(const x of [minX,maxX]){b.box('guides','steel',[x,top,(minZ+maxZ)/2],[.055,.05,maxZ-minZ],'Carril superior Z');for(const z of [minZ,maxZ])b.box('frame','paint',[x,(floor+top)/2,z],[.065,top-floor,.065],'Pata tubular');}
   for(const z of [minZ,maxZ])b.box('frame','paint',[(minX+maxX)/2,top,z],[maxX-minX,.07,.07],'Travesaño de la rejilla');
   for(const x of [minX,maxX])for(const z of [minZ,maxZ]){b.box('frame','steel',[x,floor+.01,z],[.16,.02,.16],'Placa base');for(const sign of [-1,1])b.bolt('frame',[x+sign*.05,floor+.025,z]);}
   const cap=b.component('extractor','Carro robot sobre la rejilla');cap.position.set(layout.accessPosition[0],top+.08,layout.accessPosition[2]);
   b.box(cap,'paint',[0,0,0],[.55,.16,.48],'Carro superior');for(const x of [-1,1])for(const z of [-1,1])b.cylinder(cap,'rubber',[x*.21,-.06,z*.18],.05,.045,'x',12,'Rueda del carro');
   const carriage=rig.carriage=b.component('rim-gripper','Cabezal que sujeta el borde superior del bin');carriage.position.fromArray(layout.accessPosition);carriage.position.y=top-.16;Object.assign(carriage.userData,{warehouseRackMovingGeometry:cfg.rackSystem,homePosition:carriage.position.toArray(),equipmentComponentId:def.id+'.rim-gripper'});rig.lift=rig.shuttle=carriage;
   const cw=cells[0].width,cd=cells[0].depth;b.box(carriage,'steel',[0,.055,0],[cw*.90,.055,cd*.86],'Puente de ganchos');
   for(const x of [-1,1])for(const z of [-1,1]){b.box(carriage,'steel',[x*cw*.42,-.015,z*cd*.40],[.018,.10,.018],'Gancho del borde');b.box(carriage,'rubber',[x*cw*.40,-.06,z*cd*.40],[.045,.015,.025],'Contacto de gancho');}
   b.finish();const cableMaterial=surfaces.createSurface(THREE,'Cable de izado','#323b40',{},'rubber'),cables=[];
   for(const x of [-1,1])for(const z of [-1,1]){const mesh=new THREE.Mesh(new THREE.CylinderBufferGeometry(.006,.006,1,6),cableMaterial);mesh.name='Cable entre carro y cabezal';mesh.userData.equipmentComponentId=def.id+'.hoist';root.add(mesh);cables.push({mesh,x:x*cw*.28,z:z*cd*.28});}
   sync=()=>{cap.position.x=carriage.position.x;cap.position.z=carriage.position.z;cables.forEach(({mesh,x,z})=>{const bottom=Math.min(top+.03,carriage.position.y+.09),length=Math.max(.02,top+.03-bottom);mesh.position.set(carriage.position.x+x,bottom+length/2,carriage.position.z+z);mesh.scale.y=length;});root.updateMatrixWorld(true);};
 }else{
   const orbit=layout.carousel,floor=layout.floor,r=orbit.radius,cy=orbit.centerY;
   b.ring('guides','steel',[0,cy-.175,0],r,.035,'y','Carril circular de apoyo');
   b.cylinder('frame','paint',[0,(floor+cy-.20)/2,0],.18,cy-.20-floor,'y',20,'Columna central');
   const rotor=b.component('rotor','Araña de arrastre del carrusel');rotor.userData.warehouseRackCarouselRotor=true;b.cylinder(rotor,'steel',[0,cy-.25,0],.25,.12,'y',24,'Cubo de arrastre');
   cells.forEach(cell=>{const p=cell.position,tray=b.component('tray-'+cell.index,'Bandeja nivelada '+cell.code);tray.position.fromArray(p);Object.assign(tray.userData,{warehouseRackCarouselSlot:cell.index,homePosition:p.slice(),supportTop:0,equipmentComponentId:def.id+'.tray-'+cell.index});rig.carouselTrays[cell.index]=tray;
     b.box(tray,'steel',[0,-.035,0],[cell.width,.07,cell.depth],'Superficie de bandeja');for(const z of [-1,1])b.box(tray,'paint',[0,.03,z*(cell.depth/2+.012)],[cell.width+.03,.06,.025],'Reborde de bandeja');for(const x of [-1,1])b.box(tray,'paint',[x*(cell.width/2+.012),.03,0],[.025,.06,cell.depth],'Reborde de bandeja');
     b.cylinder(tray,'rubber',[0,-.105,0],.035,.06,'x',12,'Rodillo sobre carril');b.cylinder(tray,'steel',[0,-.17,0],.018,.14,'y',10,'Pivote de arrastre');b.beam(rotor,'paint',[0,cy-.25,0],[p[0],cy-.25,p[2]],.07,'Brazo de arrastre');
   });
   for(const x of [-1,1])for(const z of [-1,1]){const px=x*r*.65,pz=z*r*.65;b.box('frame','paint',[px,(floor+cy-.18)/2,pz],[.07,cy-.18-floor,.07],'Pata tubular');b.box('frame','steel',[px,floor+.015,pz],[.16,.03,.16],'Placa base');}
   b.motor([0,cy-.42,0]);b.finish();const start=Math.atan2(cells[0].position[0],cells[0].position[2]);sync=()=>{const tray=rig.carouselTrays[0];rotor.rotation.y=Math.atan2(tray.position.x,tray.position.z)-start;root.updateMatrixWorld(true);};
 }
 cells.forEach(marker);
 const labelFactory=require('../../almacenamiento/schema/warehouseRackVisual.js').createLocationLabels;
 if(mechanism==='carousel')cells.forEach(cell=>{const label=labelFactory(THREE,[{text:cell.code,position:[0,-.065,cell.depth/2+.018],width:Math.min(.78,cell.width*.93),height:.055}]);label.userData.equipmentComponentId=def.id+'.addresses';rig.carouselTrays[cell.index].add(label);});
 else{const rows=cells.map(cell=>({text:cell.code,position:[cell.position[0],cell.position[1]-.065,cell.position[2]+cell.depth/2+.018],width:Math.min(.78,cell.width*.93),height:.055}));const labels=labelFactory(THREE,rows);labels.userData.equipmentComponentId=def.id+'.addresses';root.add(labels);}
 rig.syncMotion=sync;root.userData.warehouseRackLocationCodes=cells.map(cell=>cell.code);root.userData.warehouseRackVisualStats={profiles:0,bolts:0,connectionPlates:0,labels:Math.min(128,cells.length),slotsLabeled:Math.min(128,cells.length)};sync();return root;
}
function retireCarrierTemplateMeshes(nativeRoot,def){
 // Non-articulated carriers use a native robot record for its existing API,
 // not the gantry that happened to provide those joint/TCP anchors. Preserve
 // that graph while retiring its unrelated meshes and collision caches. This
 // also runs on a same-signature refresh, since native refresh rebuilds its rig.
 if(def.role!=='vehicle'||def.nativeKind!=='robot'||keepNative(def))return 0;
 const meshes=[],resources=new Set();
 for(const child of nativeRoot.children)if(child.userData.robotVisual)child.traverse(node=>{if(node.isMesh)meshes.push(node);});
 for(const node of meshes){if(node.geometry)resources.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[]){resources.add(material);for(const texture of Object.values(material))if(texture&&texture.isTexture&&!(texture.userData&&texture.userData.sharedIndustrialTexture))resources.add(texture);}if(node.parent)node.parent.remove(node);}
 resources.forEach(resource=>resource.dispose());
 const rig=nativeRoot.userData.robotRig;if(rig){rig.collisionBodies=[];rig.collisionGroups=[];}
 return meshes.length;
}
function applyEquipmentGeometry(nativeRoot,def,cfg,deps={}){
 if(!nativeRoot)return false;retireCarrierTemplateMeshes(nativeRoot,def);const signature=JSON.stringify([VERSION,def.id,cfg.length,cfg.width,cfg.depth,cfg.height,cfg.supportHeight,cfg.radius,cfg.rise,cfg.frameColor,cfg.accentColor,cfg.detail,cfg.wear,deps.layout&&deps.layout.floor,deps.layout&&deps.layout.path&&deps.layout.path.points]);
 if(nativeRoot.userData.catalogueGeometrySignature===signature)return false;
 const geometry=createEquipmentGeometry(def,cfg,deps);if(!geometry){nativeRoot.userData.catalogueGeometrySignature=signature;return false;}
 const old=nativeRoot.children.find(n=>n.userData.catalogueGeometryBody);if(old){nativeRoot.remove(old);disposeGeometry(old);}
 const kind=def.nativeKind;
 // Keep native actor slot numbers, especially the actual panel and controls.
 // New catalogue actors have their own versioned mechanical subtree. Retiring
 // an old body releases its buffers and leaves no invisible collision geometry.
 const hidden=kind==='processor'?[0,1,3]:kind==='source'?[0,1]:kind==='conveyor'?[0,1,2,3]:kind==='product'?[...nativeRoot.children.keys()]:kind==='palletQueue'?[0]:kind==='sensor'?[0,1,2,3,4]:[];
 hidden.forEach(index=>{const node=nativeRoot.children[index];if(node&&!node.userData.catalogueGeometryBody){const placeholder=new deps.THREE.Group();placeholder.name=node.name;placeholder.userData.catalogueGeometryReplaced=true;nativeRoot.remove(node);nativeRoot.add(placeholder);nativeRoot.children.splice(nativeRoot.children.indexOf(placeholder),1);nativeRoot.children.splice(index,0,placeholder);disposeGeometry(node);}});
 geometry.userData.catalogueGeometryBody=true;nativeRoot.add(geometry);nativeRoot.userData.catalogueGeometrySignature=signature;nativeRoot.userData.catalogueGeometryReplaces=hidden;nativeRoot.updateMatrixWorld(true);return true;
}
module.exports={VERSION,createEquipmentGeometry,applyEquipmentGeometry,keepNative,disposeGeometry,createCatalogueStorageVisual,animateEquipment};
