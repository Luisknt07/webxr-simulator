import * as THREE from 'three';

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
    geometry.translate(0, 0, -depth / 2); return mesh(name, geometry, role, parent, position);
  };
  const solid = (name, size, role, parent, position, radius = bevel) => {
    const [w,h,d] = size, r = Math.min(radius,w*.18,h*.18,d*.18);
    return shapeExtrusion(name, [[-w/2+r,-h/2], [w/2-r,-h/2], [w/2,-h/2+r], [w/2,h/2-r], [w/2-r,h/2], [-w/2+r,h/2], [-w/2,h/2-r], [-w/2,-h/2+r]], d, role, parent, position, r*.5);
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
    const labels=[['HELLO','INDUSTRIAL'],['CAPACITY',Math.round(c.payloadKg)+' KG'],['CAUTION','MOVING LOAD'],['NO RIDERS','KEEP CLEAR'],['ELECTRIC','HIGH VOLT'],['SERIAL',c.serial||'HS-018'],['LIFT','TILT'],['REACH','SHIFT']];
    labels.forEach((lines,index)=>{const x=index%4*128,y=Math.floor(index/4)*128;rect(x+2,y+2,124,60,index===2||index===3?yellow:dark);text(lines[0],x+8,y+9,lines[0].length>9?1:2,index===2||index===3?dark:white);text(lines[1],x+8,y+36,lines[1].length>10?1:2,index===2||index===3?dark:white);});
    const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);texture.name='HELLO industrial vehicle decal atlas';texture.encoding=THREE.sRGBEncoding;texture.flipY=false;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
    decalMaterial=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});decalMaterial.name='Etiquetas industriales · atlas';return decalMaterial;
  }
  const decal=(parent,index,size,position,rotation=[0,0,0],host=null)=>{
    if(c.decals===false)return null;const geo=new THREE.PlaneBufferGeometry(...size),uv=geo.attributes.uv, x=index%4*128,y=Math.floor(index/4)*128;
    // Typed-array texels are uploaded without image flipping. Reverse V in the
    // sub-rectangle itself so text is upright and never samples its empty half.
    for(let i=0;i<uv.count;i++)uv.setXY(i,(x+2+uv.getX(i)*124)/512,(y+2+(1-uv.getY(i))*60)/256);
    const object=new THREE.Mesh(geo,atlas());object.name=['Marca HELLO','Capacidad nominal','Aviso de mecanismo','Aviso no pasajeros','Aviso eléctrico','Placa de serie','Funciones lift tilt','Funciones reach shift'][index];object.position.fromArray(position);object.rotation.fromArray(rotation);object.castShadow=false;object.receiveShadow=false;object.userData.industrialMaterialRole='decals';object.userData.industrialPart=object.name;object.userData.vehicleDecal=true;object.userData.vehicleDecalIndex=index;if(host){host.userData.vehiclePreserve=true;Object.defineProperty(object.userData,'vehicleDecalHost',{value:host,enumerable:false});}parent.add(object);return object;
  };
  function batch(parent) {
    parent.children.filter(node=>node.isGroup).forEach(batch);
    const sets=new Map(); parent.children.forEach(node=>{if(!node.isMesh||node.isInstancedMesh||node.children.length||node.userData.vehiclePreserve||node.userData.vehicleDecal||node.material.transparent)return;const list=sets.get(node.material)||[];list.push(node);sets.set(node.material,list);});
    sets.forEach((nodes,material)=>{
      if(nodes.length<4)return;const geometries=nodes.map(node=>{if(node.matrixAutoUpdate)node.updateMatrix();let geometry=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();geometry.applyMatrix(node.matrix);return geometry;});
      const geometry=new THREE.BufferGeometry(); ['position','normal','uv'].forEach(key=>{if(!geometries.every(geo=>geo.attributes[key]))return;const size=geometries[0].attributes[key].itemSize,array=new Float32Array(geometries.reduce((sum,geo)=>sum+geo.attributes[key].array.length,0));let offset=0;geometries.forEach(geo=>{array.set(geo.attributes[key].array,offset);offset+=geo.attributes[key].array.length;});geometry.setAttribute(key,new THREE.BufferAttribute(array,size));});
      const object=new THREE.Mesh(geometry,material);object.name='Conjunto · '+material.name;object.castShadow=object.receiveShadow=true;object.userData=Object.assign({},nodes[0].userData,{industrialComponents:nodes.map(node=>node.name)});nodes.forEach(node=>parent.remove(node));parent.add(object);geometries.forEach(geo=>geo.dispose());
    });
  }
  return {level,segments,bevel,solid,shapeExtrusion,torus,hose,bolts,decal,batch};
}
