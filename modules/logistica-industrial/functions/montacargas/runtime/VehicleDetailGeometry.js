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
function castingBox(size, radius, quality) {
  const half=size.map(value=>value/2),r=Math.max(0,Math.min(radius,...half.map(value=>value*.44)));
  if(r<1e-6)return new THREE.BoxBufferGeometry(...size);
  const cuts=quality===0||r<.010?1:quality+1,axis=half.map(h=>{const values=[];for(let i=0;i<=cuts;i++)values.push(-h+r*i/cuts);for(let i=0;i<=cuts;i++)values.push(h-r+r*i/cuts);return values;}),positions=[],normals=[],uvs=[],indices=[];
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
  return {level,segments,bevel,solid,contactPlate,casting,shapeExtrusion,torus,hose,bolts,decal,batch};
}
