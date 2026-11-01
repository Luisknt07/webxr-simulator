import * as THREE from 'three';

// r112 extrusion side walls are unindexed triangles. Default vertex normals
// therefore reveal every triangulation diagonal, even on a continuous casting.
// Blend coincident corners by angle while retaining real folded-sheet creases.
// Positions, UVs, indices, draw groups and contact envelopes stay byte-identical.
function manufacturedNormals(geometry, degrees = 52) {
  const p=geometry.attributes.position,index=geometry.index,normal=geometry.attributes.normal;
  if(!p||!normal||index)return geometry;
  const original=normal.array.slice(),buckets=new Map(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3(),face=new THREE.Vector3(),limit=Math.cos(degrees*Math.PI/180);
  for(let i=0;i+2<p.count;i+=3){
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);face.crossVectors(u.copy(b).sub(a),v.copy(c).sub(a));
    if(face.lengthSq()<1e-22)continue;face.normalize();const points=[a,b,c];
    for(let corner=0;corner<3;corner++){const at=i+corner,point=points[corner],weight=u.copy(points[(corner+1)%3]).sub(point).angleTo(v.copy(points[(corner+2)%3]).sub(point));
      const key=[point.x,point.y,point.z].map(n=>Math.round(n*1e6)).join(':');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({at,x:face.x,y:face.y,z:face.z,weight});}
  }
  for(const entries of buckets.values())for(const own of entries){let x=0,y=0,z=0;for(const other of entries){if(own.x*other.x+own.y*other.y+own.z*other.z<limit)continue;x+=other.x*other.weight;y+=other.y*other.weight;z+=other.z*other.weight;}const length=Math.hypot(x,y,z);if(length>1e-12)normal.setXYZ(own.at,x/length,y/length,z/length);else normal.setXYZ(own.at,...original.subarray(own.at*3,own.at*3+3));}
  normal.needsUpdate=true;geometry.userData.manufacturedNormals={creaseDegrees:degrees,vertices:p.count};return geometry;
}

// A casting is a rounded solid, not eight separately rounded profile corners
// bevelled for a second time. The latter generated narrow overlapping bevel
// bands on thin consoles and visibly faceted diagonal highlights. Construct
// each surface from the same rounded-box distance field instead: continuous
// analytic normals and the requested external envelope, at a bounded cost.
function castingBox(size, radius, quality, centreSamples=false) {
  const half=size.map(value=>value/2),r=Math.max(0,Math.min(radius,...half.map(value=>value*.44)));
  if(r<1e-6)return new THREE.BoxBufferGeometry(...size);
  const cuts=quality===0||r<.010?1:quality+1,axis=half.map(h=>{const values=[];for(let i=0;i<=cuts;i++)values.push(-h+r*i/cuts);if(centreSamples)values.push(0);for(let i=0;i<=cuts;i++)values.push(h-r+r*i/cuts);return values;}),positions=[],normals=[],uvs=[],indices=[];
  const dimensions=[[1,2,0,1],[2,1,0,-1],[2,0,1,1],[0,2,1,-1],[0,1,2,1],[1,0,2,-1]];
  dimensions.forEach(([u,v,fixed,sign])=>{
    const start=positions.length/3,width=axis[u].length,height=axis[v].length;
    for(let j=0;j<height;j++)for(let i=0;i<width;i++){
      const point=[0,0,0];point[fixed]=half[fixed]*sign;point[u]=axis[u][i];point[v]=axis[v][j];
      const core=point.map((value,k)=>THREE.Math.clamp(value,-half[k]+r,half[k]-r)),delta=new THREE.Vector3(point[0]-core[0],point[1]-core[1],point[2]-core[2]).normalize();
      positions.push(core[0]+delta.x*r,core[1]+delta.y*r,core[2]+delta.z*r);normals.push(delta.x,delta.y,delta.z);uvs.push((point[u]+half[u])/size[u],(point[v]+half[v])/size[v]);
    }
    for(let j=0;j<height-1;j++)for(let i=0;i<width-1;i++){const a=start+j*width+i,b=a+1,c=a+width,d=c+1;indices.push(a,b,c,b,d,c);}
  });
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
  geometry.userData.manufacturedProfile='rounded-distance-field';geometry.userData.manufacturedEnvelope=size.slice();geometry.userData.manufacturedRadius=r;geometry.computeBoundingBox();return geometry;
}

// Selective swept/extruded profiles provide machined edges without a CAD kernel
// or a dense imported asset. Dimensions remain in metres and vehicle-local.
export function createVehicleDetailBuilder(b, c) {
  const level = c.detail === 'low' ? 0 : c.detail === 'high' ? 2 : 1;
  const segments = [12, 20, 28][level], bevel = Math.min(c.filletRadius || .018, .04);
  const mesh = (name, geo, role, parent, position) => b.mesh(name, geo, role, parent, position);
  const shapeExtrusion = (name, points, depth, role, parent, position, radius = bevel) => {
    const shape = new THREE.Shape(), corner = (point, toward) => {const length=Math.hypot(toward[0]-point[0],toward[1]-point[1]),amount=Math.min(radius*1.5,length*.32);return [point[0]+(toward[0]-point[0])*amount/(length||1),point[1]+(toward[1]-point[1])*amount/(length||1)];};
    shape.moveTo(...corner(points[0],points[points.length-1]));
    points.forEach((point,index)=>{const incoming=corner(point,points[(index+points.length-1)%points.length]),outgoing=corner(point,points[(index+1)%points.length]);shape.lineTo(...incoming);shape.quadraticCurveTo(...point,...outgoing);});shape.closePath();
    const geometry = new THREE.ExtrudeBufferGeometry(shape, {depth, steps: 1, curveSegments: 1 + level,
      bevelEnabled: radius > 0, bevelThickness: radius, bevelSize: radius, bevelSegments: level + 1});
    geometry.translate(0, 0, -depth / 2); manufacturedNormals(geometry);return mesh(name, geometry, role, parent, position);
  };
  const solid = (name, size, role, parent, position, radius = bevel) => {
    const [w,h,d] = size, r = Math.min(radius,w*.18,h*.18,d*.18);
    return mesh(name,b.geometry('casting:'+size.join(',')+':'+r+':'+level,()=>castingBox(size,r,level)),role,parent,position);
  };
  const contactPlate = (name, size, role, parent, position, radius) => {
    // The load carriage is an existing physical contact surface: retain its
    // folded/bevelled flange dimensions instead of shrinking the jaw envelope
    // to a cosmetic casting. Pickup checks must still see wood at the heel.
    const [w,h,d]=size,r=Math.min(radius,w*.18,h*.18,d*.18);
    return shapeExtrusion(name,[[-w/2+r,-h/2],[w/2-r,-h/2],[w/2,-h/2+r],[w/2,h/2-r],[w/2-r,h/2],[-w/2+r,h/2],[-w/2,h/2-r],[-w/2,-h/2+r]],d,role,parent,position,r*.5);
  };
  const casting = (name, sections, role, parent, position) => {
    const vertices=[],uvs=[],indices=[],count=4*(3+level);
    sections.forEach(([y,width,depth,z=0])=>{const radius=Math.min(width*.13,depth*.22);for(let corner=0;corner<4;corner++)for(let step=0;step<3+level;step++){
      // Quarter-circle corner centres, traversed counter-clockwise in X/Z.
      const theta=corner*Math.PI/2+step*Math.PI/(2*(2+level)),cx=(corner===0||corner===3?1:-1)*(width/2-radius),cz=(corner<2?1:-1)*(depth/2-radius),a=theta;
      const px=cx+Math.cos(a)*radius,pz=cz+Math.sin(a)*radius;
      vertices.push(px,y,pz+z);uvs.push((corner+step/(2+level))/4,(y-sections[0][0])/Math.max(.001,sections[sections.length-1][0]-sections[0][0]));
    }});
    // The round perimeter starts at the right/rear corner and follows +Z,
    // then -X/-Z. Side surfaces share vertices; end caps use independent
    // vertices so their plane does not round the silhouette's end faces.
    for(let ring=0;ring<sections.length-1;ring++)for(let i=0;i<count;i++){const a=ring*count+i,b=ring*count+(i+1)%count,c=a+count,d=b+count;indices.push(a,c,b,b,c,d);}
    const geometry=new THREE.BufferGeometry();
    // Caps are fans around a point inside the convex rounded perimeter.
    for(const [ring,top]of [[0,false],[sections.length-1,true]]){const center=vertices.length/3,[y,,,z=0]=sections[ring];vertices.push(0,y,z);uvs.push(.5,.5);for(let i=0;i<count;i++){const at=vertices.length/3,source=(ring*count+i)*3,next=(ring*count+(i+1)%count)*3;vertices.push(...vertices.slice(source,source+3),...vertices.slice(next,next+3));uvs.push(0,0,1,1);if(top)indices.push(center,at+1,at);else indices.push(center,at,at+1);}}
    // r112 reuses an existing normal attribute. Allocate normals only after
    // cap vertices have been appended, or their accessor is shorter than the
    // POSITION/UV accessors and a browser GLB cannot be imported by Blender.
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.userData.manufacturedProfile='section-loft';geometry.userData.manufacturedSections=sections.map(row=>row.slice());geometry.computeBoundingBox();
    return mesh(name,geometry,role,parent,position);
  };
  const torus = (name, radius, tube, role, parent, position, arc = Math.PI * 2) => mesh(name,
    b.geometry('torus:'+[radius,tube,segments,arc].join(','), () => new THREE.TorusBufferGeometry(radius, tube, 6 + level * 2, segments, arc)), role, parent, position);
  const hose = (name, points, radius, parent, role = 'rubber') => {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3().fromArray(point)));
    return mesh(name,new THREE.TubeBufferGeometry(curve,8+level*6,radius,5+level,false),role,parent);
  };
  const bolts = (parent, points, radius = .012, role = 'steel', axis = [1,0,0]) => {
    if (!points.length) return null;
    const geometry = b.geometry('bolt:'+radius,()=>new THREE.CylinderBufferGeometry(radius,radius,radius*.8,6)), object = new THREE.InstancedMesh(geometry,b.materials[role],points.length);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3().fromArray(axis)), matrix = new THREE.Matrix4();
    points.forEach((point,index)=>{matrix.compose(new THREE.Vector3().fromArray(point),rotation,new THREE.Vector3(1,1,1));object.setMatrixAt(index,matrix);});
    object.name='Fijaciones hexagonales'; object.castShadow=object.receiveShadow=true; object.userData.industrialMaterialRole=role;object.userData.industrialPart='Tornillería';parent.add(object);return object;
  };
  let decalMaterial;
  function atlas() {
    if(decalMaterial)return decalMaterial;
    const width=512,height=256, data=new Uint8Array(width*height*4);
    const rect=(x,y,w,h,color)=>{for(let row=Math.max(0,y);row<Math.min(height,y+h);row++)for(let col=Math.max(0,x);col<Math.min(width,x+w);col++){const i=(row*width+col)*4;data.set(color,i);}};
    const glyphs={A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01110'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],'0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],'2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],'6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],'-':['00000','00000','00000','11111','00000','00000','00000']};
    const text=(value,x,y,size,color)=>String(value).toUpperCase().slice(0,19).split('').forEach((letter,index)=>(glyphs[letter]||[]).forEach((row,r)=>row.split('').forEach((pixel,k)=>{if(pixel==='1')rect(x+index*6*size+k*size,y+r*size,size,size,color);})));
    const dark=[24,32,38,255],white=[237,241,231,255],yellow=[239,188,41,255];
    const labels=[['SMARTTWIN','SIMULATION'],['CAPACITY',Math.round(c.payloadKg)+' KG'],['CAUTION','MOVING LOAD'],['NO RIDERS','KEEP CLEAR'],['ELECTRIC','HIGH VOLT'],['SERIAL',c.serial||'HS-018'],['LIFT','TILT'],['REACH','SHIFT']];
    labels.forEach((lines,index)=>{const x=index%4*128,y=Math.floor(index/4)*128;rect(x+2,y+2,124,60,index===2||index===3?yellow:dark);text(lines[0],x+8,y+9,lines[0].length>9?1:2,index===2||index===3?dark:white);text(lines[1],x+8,y+36,lines[1].length>9?1:2,index===2||index===3?dark:white);});
    const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);texture.name='SmartTwin vehicle decal atlas';texture.encoding=THREE.sRGBEncoding;texture.flipY=false;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
    decalMaterial=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});decalMaterial.name='Etiquetas industriales · atlas';return decalMaterial;
  }
  const decal=(parent,index,size,position,rotation=[0,0,0],host=null)=>{
    if(c.decals===false)return null;const geo=new THREE.PlaneBufferGeometry(...size),uv=geo.attributes.uv, x=index%4*128,y=Math.floor(index/4)*128;
    // Typed-array texels are uploaded without image flipping. Reverse V in the
    // sub-rectangle itself so text is upright and never samples its empty half.
    for(let i=0;i<uv.count;i++)uv.setXY(i,(x+2+uv.getX(i)*124)/512,(y+2+(1-uv.getY(i))*60)/256);
    const object=new THREE.Mesh(geo,atlas());object.name=['Identificaci?n SmartTwin','Capacidad nominal','Aviso de mecanismo','Aviso no pasajeros','Aviso eléctrico','Placa de serie','Funciones lift tilt','Funciones reach shift'][index];object.position.fromArray(position);object.rotation.fromArray(rotation);object.castShadow=false;object.receiveShadow=false;object.userData.industrialMaterialRole='decals';object.userData.industrialPart=object.name;object.userData.vehicleDecal=true;object.userData.vehicleDecalIndex=index;if(host){host.userData.vehiclePreserve=true;Object.defineProperty(object.userData,'vehicleDecalHost',{value:host,enumerable:false});}parent.add(object);return object;
  };
  // Native four-wheel reference pilot. These are cosmetic parts of the SAME
  // operational truck: no fork, seat-view, hydraulic-control or wheel pivots
  // are replaced. Dimensions remain authored SmartTwin dimensions, not an OEM
  // replica. Proportion references: CAT EP25-35A(C)N / Toyota Core Electric.
  const yzProfile=(name,points,width,role,parent,radius=.008)=>{
    const object=shapeExtrusion(name,points.map(([z,y])=>[-z,y]),width,role,parent,[0,0,0],radius);object.rotation.y=Math.PI/2;return object;
  };
  const preserve=object=>{object.userData.vehiclePreserve=true;return object;};
  function referenceChassis(parent){
    // Keep the original front/rear contact planes and overall envelope, but
    // form actual wheel wells rather than running a solid slab through tyres.
    const half=c.width/2,end=c.length/2,axle=c.wheelbase/2,clear=c.wheelRadius*1.08+.018,inner=Math.min(c.track/2-c.width*.075-.027,c.width*.32),rearInner=Math.max(.08,c.track/2-Math.hypot(c.wheelRadius,c.width*.075)-.026),outerStart=Math.min(end-.03,axle+clear),innerEnd=Math.max(.06,axle-clear);
    const right=[[half,-end],[half,-outerStart],[rearInner,-outerStart],[rearInner,-innerEnd],[half,-innerEnd],[half,innerEnd],[inner,innerEnd],[inner,outerStart],[half,outerStart],[half,end]],points=[[-half,-end],...right,[-half,end],...right.slice(1,-1).reverse().map(([x,z])=>[-x,z])];
    const chassis=preserve(shapeExtrusion('Bastidor inferior biselado',points,.20,'accent',parent,[0,Math.max(.18,c.wheelRadius-.04),0],Math.min(dimensionalBevel(),.0125)));chassis.rotation.x=Math.PI/2;chassis.userData.equipmentComponentId='vehicle.chassis';chassis.userData.referenceWheelWells=true;return chassis;
  }
  function dimensionalBevel(){return Math.min(c.filletRadius||.018,.04,c.width*.18,.20*.18,c.length*.18)/2;}
  function referenceBody(rig,parent){
    const w=c.width,l=c.length,back=-l*.495,front=Math.min(-l*.27,-l*.08-.55),depth=front-back,z=(back+front)/2;
    // The casting has an actual undercut over the rear steering tyres. Its low
    // skirt stays behind the swept axle instead of cutting through the wheels.
    const rearLip=Math.min(.048,depth*.11),top=Math.min(.94,c.height*.44),clear=c.wheelRadius*2+.045;
    const rear=preserve(casting('Contrapeso piloto · fundición envolvente',[
      [.25,w*.76,rearLip,back+rearLip/2-z],
      [.33,w*.86,rearLip*1.08,back+rearLip*.54-z],
      [clear-.025,w*.91,rearLip*1.16,back+rearLip*.58-z],
      [clear+.025,w*.96,depth*.97,0],
      [top-.10,w*.93,depth,0],
      [top,w*.77,depth*.82,-depth*.025]
    ],'frame',parent,[0,0,z]));
    rear.userData.equipmentComponentId='vehicle.counterweight';rig.counterweight=rear;rig.rearBodyZ=back;
    const deckHalf=w*.39,rearNarrow=Math.max(.08,c.track/2-Math.hypot(c.wheelRadius,w*.075)-.026),deckPoints=[[-rearNarrow,-l*.275],[rearNarrow,-l*.275],[rearNarrow,-l*.19],[deckHalf,-l*.19],[deckHalf,l*.195],[-deckHalf,l*.195],[-deckHalf,-l*.19],[-rearNarrow,-l*.19]];
    const deck=shapeExtrusion('Módulo bajo de batería · piloto',deckPoints,.145,'frame',parent,[0,.33,0],.008);deck.rotation.x=Math.PI/2;deck.userData.equipmentComponentId='vehicle.power';
    for(const side of [-1,1]){
      const sill=yzProfile('Faldón lateral piloto · umbral perfilado',[[-l*.185,.27],[-l*.185,.45],[-l*.14,.49],[l*.13,.43],[l*.21,.30],[l*.21,.23]],.032,'frame',parent,.016);sill.position.x=side*(w*.47);sill.userData.equipmentComponentId='vehicle.chassis';
      const battery=solid('Registro de batería piloto',[.012,.11,l*.31],'accent',parent,[side*(w*.39+.007),.33,-l*.04],.004);battery.userData.equipmentComponentId='vehicle.power';
      for(const at of [-l*.14,l*.06]){const lock=b.cylinder('Cierre del compartimento eléctrico',.017,.012,'steel',parent,[side*(w*.39+.015),.33,at],8);lock.rotation.z=Math.PI/2;lock.userData.equipmentComponentId='vehicle.power';}
      // A real recessed step: open spaces between bars, not coplanar black
      // rectangles laid over an opaque shelf to imitate perforations.
      const step=new THREE.Group();step.name='Escalón piloto · rejilla abierta';step.position.set(side*(w*.38+.06),.278,-l*.08-.08);step.userData.equipmentComponentId='vehicle.safety';parent.add(step);
      for(const at of [-1,1])solid('Marco de escalón',[.18,.035,.022],'accent',step,[0,0,at*.18],.004);
      for(let n=-3;n<=3;n++)b.box('Barra antideslizante de escalón',[.15,.018,.012],'steel',step,[0,.010,n*.047]);
      const taper=(w*.96-w*.93)/2/Math.max(.04,top-.10-clear-.025),plateX=w*.48-taper*.060;
      const plate=solid('Placa de identificación piloto',[.012,.105,depth*.57],'accent',parent,[side*(plateX+.004),clear+.085,z],.003);plate.rotation.z=side*Math.atan(taper);
      decal(plate,0,[Math.min(.20,depth*.53),.055],[side*.0068,0,0],[0,side*Math.PI/2,0],plate);
    }
    // Narrow formed front cowl sits BETWEEN the tyres, with fenders providing
    // the wider shoulders. It does not fill the steering/pedal footwell.
    const nose=yzProfile('Capó delantero piloto · panel curvo',[[l*.18,.30],[l*.18,.51],[l*.24,.77],[l*.32,.82],[l*.43,.65],[l*.46,.35]],w*.60,'frame',parent,.025);nose.userData.equipmentComponentId='vehicle.chassis';
    const grille=solid('Rejilla posterior piloto',[w*.48,.17,.014],'accent',parent,[0,clear+.085,back-.004],.006);grille.userData.equipmentComponentId='vehicle.cooling';
    for(let n=-2;n<=2;n++){const slat=b.box('Aleta de ventilación posterior',[w*.41,.012,.014],'accent',parent,[0,clear+.085+n*.027,back-.014]);slat.rotation.x=.30;slat.userData.equipmentComponentId='vehicle.cooling';}
    const cover=solid('Tapa superior de contrapeso',[w*.56,.012,depth*.49],'accent',parent,[0,top+.007,z-depth*.025],.004);cover.userData.equipmentComponentId='vehicle.counterweight';
    decal(parent,2,[.18,.055],[0,top+.014,z-depth*.025],[-Math.PI/2,0,0],cover);
    const bumper=solid('Inserto posterior de paragolpes',[w*.60,.065,.021],'rubber',parent,[0,.325,back-.015],.008);bumper.userData.equipmentComponentId='vehicle.counterweight';
  }
  function referenceWheel(parent,radius,width){
    const profile=[[-.50,.69],[-.49,.80],[-.43,.91],[-.29,.966],[.29,.966],[.43,.91],[.49,.80],[.50,.69],[.50,.57],[-.50,.57],[-.50,.69]].map(([x,r])=>new THREE.Vector2(radius*r,width*x));
    const tyre=mesh('Neumático piloto · hombros y carcasa',b.geometry('pilot-tyre:'+radius+':'+width+':'+level,()=>new THREE.LatheBufferGeometry(profile,segments)),'rubber',parent,[0,0,0]);tyre.rotation.z=Math.PI/2;
    // Independent chevron lugs follow the curved tread. Their peaks stay within
    // the unchanged rolling radius; no tread tooth penetrates the ground.
    const pos=[],uv=[],ix=[],count=[12,24,32][level];
    for(let n=0;n<count;n++)for(const bank of [-1,1]){
      const start=pos.length/3,phase=(n+(bank>0?.24:0))*Math.PI*2/count;
      for(const rad of [.960,1])for(const axial of [0,1])for(const along of [0,1]){
        const x=bank*width*(.035+axial*.32),angle=phase+(axial*.12*bank)+(along-.5)*Math.PI/count*.60;
        pos.push(x,Math.cos(angle)*radius*rad,Math.sin(angle)*radius*rad);uv.push(axial,along);
      }
      // Eight vertices, six outward faces; hard treads have per-face normals.
      const faces=[[0,1,2,1,3,2],[4,6,5,5,6,7],[0,4,1,1,4,5],[2,3,6,3,7,6],[0,2,4,2,6,4],[1,5,3,3,5,7]];
      faces.forEach(face=>{for(let i=0;i<face.length;i+=3)ix.push(start+face[i],start+face[i+(bank>0?2:1)],start+face[i+(bank>0?1:2)]);});
    }
    const lugGeometry=new THREE.BufferGeometry();lugGeometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));lugGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));lugGeometry.setIndex(ix);const hard=lugGeometry.toNonIndexed();lugGeometry.dispose();hard.computeVertexNormals();
    const tread=mesh('Rodadura piloto · tacos diagonales',hard,'rubber',parent,[0,0,0]);tread.userData.equipmentComponentId='vehicle.wheels';
    const rimProfile=[[radius*.20,-width*.43],[radius*.42,-width*.43],[radius*.48,-width*.36],[radius*.55,-width*.42],[radius*.58,-width*.48],[radius*.61,-width*.48],[radius*.61,width*.48],[radius*.58,width*.48],[radius*.55,width*.42],[radius*.48,width*.36],[radius*.42,width*.43],[radius*.20,width*.43]].map(([r,y])=>new THREE.Vector2(r,y));
    const rim=mesh('Llanta piloto · disco embutido',b.geometry('pilot-rim:'+radius+':'+width+':'+level,()=>new THREE.LatheBufferGeometry(rimProfile,segments)),'steel',parent,[0,0,0]);rim.rotation.z=Math.PI/2;
    const hub=b.cylinder('Cubo de eje piloto',radius*.245,width*1.06,'accent',parent,[0,0,0],segments);hub.rotation.z=Math.PI/2;
    for(const side of [-1,1]){
      if(level>0){const bead=torus('Talón de neumático piloto',radius*.64,.006,'rubber',parent,[side*width*.498,0,0]);bead.rotation.y=Math.PI/2;}
      const count=level===0?5:6;bolts(parent,Array.from({length:count},(_,i)=>{const a=i*Math.PI*2/count;return[side*width*.457,Math.cos(a)*radius*.35,Math.sin(a)*radius*.35];}),Math.min(.012,radius*.045));
      // Dark openings have their own inset edge, never a coplanar decal.
      const openings=level===0?3:6;for(let i=0;i<openings;i++){const a=(i+.5)*Math.PI*2/openings,v=b.cylinder('Alojamiento de disco de llanta',radius*.045,.007,'accent',parent,[side*width*.435,Math.cos(a)*radius*.445,Math.sin(a)*radius*.445],6);v.rotation.z=Math.PI/2;}
    }
  }
  function referenceFender(parent,x,z,radius,width){
    const points=[],steps=8+level*3,outer=radius+.065,inner=radius+.035;
    for(let n=0;n<=steps;n++){const a=n*Math.PI/steps;points.push([Math.cos(a)*outer,Math.sin(a)*outer]);}
    for(let n=steps;n>=0;n--){const a=n*Math.PI/steps;points.push([Math.cos(a)*inner,Math.sin(a)*inner]);}
    const guard=preserve(shapeExtrusion('Guardabarros piloto · ala envolvente',points,width+.075,'frame',parent,[x,c.wheelRadius,z],0));guard.rotation.y=Math.PI/2;
    const outerX=x+Math.sign(x)*(width/2+.039),lip=preserve(shapeExtrusion('Borde de guardabarros piloto',points,.012,'accent',parent,[outerX,c.wheelRadius,z],0));lip.rotation.y=Math.PI/2;lip.userData.equipmentComponentId='vehicle.wheels';
    bolts(parent,[-1,1].map(end=>[outerX+Math.sign(x)*.007,c.wheelRadius+outer*.47,z+end*outer*.84]),.010,'steel');return guard;
  }
  function referenceCab(rig,cabin){
    const {x,z,top,floor}=rig.cabDimensions,frontTop=z-.28,rearTop=-z-.045;
    const removeNames=new Set(['Larguero de guardatecho','Travesaño de guardatecho','Barra superior de protección','Cubierta transparente superior','Parabrisas frontal','Cristal posterior','Cristal lateral','Puerta inferior','Escalón de acceso','Relieve antideslizante','Manija de acceso','Refuerzo lateral de asiento','Apoyo lumbar','Costura del asiento','Canal antideslizante']);
    cabin.children.slice().forEach(node=>{if(removeNames.has(node.name))cabin.remove(node);});
    for(const record of rig.cabPosts){const end=record.end,baseZ=end*z,target=end>0?frontTop:rearTop,length=Math.hypot(top-floor,target-baseZ),template=solid('Plantilla de pilar piloto',[.067,length,.075],'accent',new THREE.Group(),[0,0,0],.010);
      record.object.geometry=template.geometry;record.object.position.set(record.side*x,(top+floor)/2,(target+baseZ)/2);record.object.rotation.x=Math.atan2(target-baseZ,top-floor);record.object.userData.referencePilot=true;
      if(end<0){const low=-length/2,inset=record.side*Math.min(.30,x*.64),points=[[-inset-.034,low],[-inset+.034,low],[-inset+.034,low+.20],[.034,low+.36],[.034,length/2],[-.034,length/2],[-.034,low+.39],[-inset-.034,low+.23]],formed=shapeExtrusion('Plantilla de pilar posterior piloto',points,.075,'accent',new THREE.Group(),[0,0,0],.006);record.object.geometry=formed.geometry;}
    }
    const narrow=Math.max(.08,c.track/2-Math.hypot(c.wheelRadius,c.width*.075)-.026),rearEnd=THREE.Math.clamp(-c.wheelbase/2+c.wheelRadius*1.08+.018+c.length*.08,-z+.03,z-.15),floorPoints=[[-narrow,-z],[narrow,-z],[narrow,rearEnd],[x,rearEnd],[x,z],[-x,z],[-x,rearEnd],[-narrow,rearEnd]],floorShape=shapeExtrusion('Plantilla de piso piloto',floorPoints,.07,'accent',new THREE.Group(),[0,0,0],0);rig.cabFloor.geometry=floorShape.geometry;rig.cabFloor.rotation.x=Math.PI/2;
    for(let n=-2;n<=2;n++)b.box('Canal antideslizante piloto',[x*1.72,.006,.012],'rubber',cabin,[0,floor+.041,.08+n*.10]);
    for(const side of [-1,1]){
      const rail=yzProfile('Guardatecho piloto · larguero curvado',[[rearTop-.085,top-.035],[rearTop-.085,top+.055],[rearTop+.11,top+.090],[frontTop-.08,top+.065],[frontTop+.08,top+.005],[frontTop+.08,top-.045]],.085,'accent',cabin,.012);rail.position.x=side*x;rail.userData.equipmentComponentId='vehicle.safety';
      hose('Asa de entrada piloto',[[side*x,.83,z-.04],[side*x,1.28,z-.13],[side*x,1.35,z-.17]],.017,cabin,'accent').userData.equipmentComponentId='vehicle.safety';
    }
    for(const end of [-1,1])solid('Guardatecho piloto · travesaño perfilado',[x*2+.04,.06,.085],'accent',cabin,[0,top+.01,end>0?frontTop:rearTop],.012);
    for(let n=-3;n<=3;n++){const at=(n+3)/6,positionZ=rearTop+(frontTop-rearTop)*at;solid('Guardatecho piloto · lámina transversal',[x*2-.05,.028,.06],'accent',cabin,[0,top+.023+Math.sin(at*Math.PI)*.018,positionZ],level===0?0:.007);}
    if(c.cabinStyle!=='open'){
      const roof=solid('Cubierta transparente superior piloto',[x*2-.07,.006,frontTop-rearTop-.05],'glass',cabin,[0,top+.052,(frontTop+rearTop)/2],.002);roof.userData.equipmentComponentId='vehicle.safety';
    }
    if(c.cabinStyle==='enclosed'){
      for(const end of [-1,1]){const baseZ=end*z,target=end>0?frontTop:rearTop,glass=preserve(solid(end>0?'Parabrisas frontal piloto':'Cristal posterior piloto',[x*2-.10,top-.80,.010],'glass',cabin,[0,(top+.75)/2,(baseZ+target)/2]));glass.rotation.x=Math.atan2(target-baseZ,top-floor);if(end>0)rig.frontGlass=glass;}
      for(const side of [-1,1]){const glazing=yzProfile('Cristal lateral piloto',[[-z+.04,.88],[-z+.04,top-.045],[frontTop-.05,top-.045],[z-.05,.88]],.008,'glass',cabin,0);glazing.position.x=side*x;}
    }
    // Upholstery is reshaped as one continuous surface. The rim/centre are
    // connected vertices, not rounded pads intersecting one another.
    for(const [object,back]of [[rig.seatCushion,false],[rig.seatBack,true]])if(object){
      const size=back?[.45,.48,.115]:[.46,.13,.45],g=castingBox(size,.035,level,true),p=g.attributes.position;
      for(let i=0;i<p.count;i++){const px=p.getX(i),py=p.getY(i),pz=p.getZ(i),u=Math.abs(px)/(size[0]/2);
        if(back&&pz>0)p.setZ(i,pz+.022*(1-u*u)*Math.max(0,1-Math.pow(py/(size[1]/2),2))+.020*Math.pow(u,4));
        else if(!back&&py>0)p.setY(i,py+.038*Math.pow(u,4)-.012*(1-u*u)*Math.max(0,1-Math.pow(pz/(size[2]/2),2)));
      }
      g.deleteAttribute('normal');g.computeVertexNormals();const soft=g.toNonIndexed();g.dispose();manufacturedNormals(soft,105);soft.computeBoundingBox();soft.userData.manufacturedProfile='contoured-upholstery';object.geometry=soft;
    }
    if(rig.seatCushion){const surface=new THREE.Mesh(rig.seatCushion.geometry,b.materials.seat);surface.updateMatrixWorld(true);for(const side of [-1,1]){const points=[[side*.15,-.42],[side*.17,-.32],[side*.17,-.16],[side*.13,-.065]].map(([px,pz])=>{const hit=new THREE.Raycaster(new THREE.Vector3(px,.3,pz+.25),new THREE.Vector3(0,-1,0)).intersectObject(surface)[0];return[px,.81+(hit?hit.point.y:.065)+.0012,pz];});hose('Costura de tapicería piloto',points,.0012,cabin,'accent');}}
    rig.referencePilot={frontPillarSetback:z-frontTop,rearPillarSetback:-z-rearTop,roofFront:frontTop,roofRear:rearTop};
  }
  function releaseUnused(parent){const used=new Set();parent.traverse(node=>{if(node.geometry)used.add(node.geometry);});for(const geometry of b.cache.values())if(!used.has(geometry))geometry.dispose();}
  function batch(parent) {
    parent.children.filter(node=>node.isGroup).forEach(batch);
    // Blades and upright heels share a steel finish, but they have different
    // visibility roles in the occupied cab. A material-only batch inherited
    // the first blade's tag and kept both tall heels opaque in the hologram.
    const sets=new Map(); parent.children.forEach(node=>{if(!node.isMesh||node.isInstancedMesh||node.children.length||node.userData.vehiclePreserve||node.userData.vehicleDecal||node.material.transparent)return;const key=node.material.uuid+':'+(node.userData.vehicleForkBlade?'blade':'structure')+':'+(node.userData.equipmentComponentId||'');if(!sets.has(key))sets.set(key,{nodes:[],material:node.material});sets.get(key).nodes.push(node);});
    sets.forEach(({nodes,material})=>{
      if(nodes.length<(nodes[0].userData.vehicleForkTine?2:4))return;const geometries=nodes.map(node=>{if(node.matrixAutoUpdate)node.updateMatrix();let geometry=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();geometry.applyMatrix(node.matrix);return geometry;});
      const geometry=new THREE.BufferGeometry(); ['position','normal','uv'].forEach(key=>{if(!geometries.every(geo=>geo.attributes[key]))return;const size=geometries[0].attributes[key].itemSize,array=new Float32Array(geometries.reduce((sum,geo)=>sum+geo.attributes[key].array.length,0));let offset=0;geometries.forEach(geo=>{array.set(geo.attributes[key].array,offset);offset+=geo.attributes[key].array.length;});geometry.setAttribute(key,new THREE.BufferAttribute(array,size));});
      let cursor=0;const ranges=nodes.map((node,index)=>{const range={name:node.name,componentId:node.userData.equipmentComponentId||'',start:cursor,count:geometries[index].attributes.position.count};cursor+=range.count;return range;});
      const object=new THREE.Mesh(geometry,material);object.name='Conjunto · '+material.name;object.castShadow=object.receiveShadow=true;object.userData=Object.assign({},nodes[0].userData,{industrialComponents:nodes.map(node=>node.name),industrialComponentRanges:ranges});nodes.forEach(node=>parent.remove(node));parent.add(object);geometries.forEach(geo=>geo.dispose());
    });
  }
  return {level,segments,bevel,solid,contactPlate,casting,shapeExtrusion,torus,hose,bolts,decal,batch,referenceChassis,referenceBody,referenceWheel,referenceFender,referenceCab,releaseUnused};
}
