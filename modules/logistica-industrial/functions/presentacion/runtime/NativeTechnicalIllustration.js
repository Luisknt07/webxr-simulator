import * as THREE from 'three';
import technicalProjection from '../../../../../packages/render-three/src/TechnicalProjection.js';

const LIMITS = Object.freeze({meshes:400, faces:10000, sourceFaces:20000});
const MODES = ['isometric','front','top','exploded'];
const BOUNDS = new WeakMap();
const TOPOLOGY = new Map();let cachedTriangles=0;
const KEY_LIGHT = new THREE.Vector3(-.45,.85,.65).normalize(), FILL_LIGHT = new THREE.Vector3(.7,.45,-.6).normalize();
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
function jointOf(object){for(let node=object;node;node=node.parent){const data=node.userData||{},id=data.robotJointId||data.robotJoint;if(typeof id==='string'&&id)return id;}return '';}
function componentsOf(object){const ids=[];for(let node=object;node;node=node.parent){const data=node.userData||{};for(const id of [data.equipmentComponentId,data.robotComponentId,data.industrialComponentId,data.componentId])if(typeof id==='string'&&id&&!ids.includes(id))ids.push(id);}return ids;}
function machineOwner(object) {
  const data=object.userData||{},key=data.editorPrefabKey||data.editorDescriptor&&data.editorDescriptor.prefab;
  return ['robot','conveyor','vehicle','source','processor','palletQueue'].includes(key)||data.robotRig||data.vehicleRig||data.warehouseRackRig;
}
function visible(object, root) {
  for(let node=object;node;node=node.parent){
    if(!node.visible || node.userData.editorHelper || node.userData.editorRuntimeHelper || node.userData.editorGeometryReplaced || node.userData.industrialSensorVolume)return false;
    // The machine's mechanical illustration has its own framing. An attached
    // full-size HMI must not shrink the arm/deck to a thumbnail. A PLC selected
    // in its own right (including a wrapper) still shows its complete model.
    if(node!==root&&node.userData.editorPrefabKey==='plc')for(let parent=node.parent;parent;parent=parent.parent){if(machineOwner(parent))return false;if(parent===root)break;}
    if(node===root)break;
  }
  return true;
}
function boxPoints(bounds,matrix) {
  const values=[];for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])values.push(new THREE.Vector3(x,y,z).applyMatrix4(matrix));return values;
}

/** A read-only description of actual native surfaces and their current pose.
 * It holds references, never clones live GPU geometry/materials or renders a
 * second scene. Instances and draw ranges retain their real transformations. */
function capture(object,options={}) {
  const meshLimit=Math.floor(clamp(finite(options.maxMeshes)?options.maxMeshes:LIMITS.meshes,1,LIMITS.meshes));
  const meshes=[];let truncatedMeshes=0,omittedInstances=0,sourceTriangles=0;object.updateWorldMatrix(true,true);
  const inverse=new THREE.Matrix4().getInverse(object.matrixWorld),scale=new THREE.Matrix4().makeScale(object.scale.x,object.scale.y,object.scale.z);
  object.traverse(mesh=>{
    const geometry=mesh.geometry,position=geometry&&geometry.attributes&&geometry.attributes.position;
    if(!mesh.isMesh||!position||!visible(mesh,object))return;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    if(!materials.some(material=>material&&material.visible!==false&&(material.opacity===undefined||material.opacity>=.2)))return;
    const names=[];for(let parent=mesh;parent&&parent!==object;parent=parent.parent)if(parent.name)names.push(parent.name.toLowerCase());
    const total=geometry.index?geometry.index.count:position.count,range=geometry.drawRange||{},start=Math.max(0,range.start||0),end=Math.min(total,start+(range.count===undefined?total:range.count));
    if(start%3||!finite(start)||end<start)return;
    const count=Math.floor((end-start)/3),instances=mesh.isInstancedMesh?mesh.count:1;
    if(!Number.isSafeInteger(instances)||instances<0)return;sourceTriangles+=count*instances;
    const available=Math.max(0,meshLimit-meshes.length);if(instances>available){truncatedMeshes++;omittedInstances+=instances-available;}
    for(let instance=0;instance<instances&&meshes.length<meshLimit;instance++){
      const world=new THREE.Matrix4().copy(mesh.matrixWorld);if(mesh.isInstancedMesh){const local=new THREE.Matrix4();mesh.getMatrixAt(instance,local);world.multiply(local);}
      const matrix=new THREE.Matrix4().multiplyMatrices(scale,inverse).multiply(world);if(!matrix.elements.every(finite))continue;
      meshes.push({mesh,geometry,position,materials,names:names.join(' / '),jointId:jointOf(mesh),componentIds:componentsOf(mesh),role:mesh.userData.industrialMaterialPart||mesh.userData.materialPart||mesh.userData.role||'',matrix,count,start,instance});
    }
  });Object.defineProperties(meshes,{truncatedMeshes:{value:truncatedMeshes},omittedInstances:{value:omittedInstances},sourceTriangles:{value:sourceTriangles}});return meshes;
}

function projection(mode) {
  const options={origin:[0,0],scale:1,azimuth:45,elevation:30},c=technicalProjection.cameraOf(options);
  const camera=mode==='front'?new THREE.Vector3(0,0,1):mode==='top'?new THREE.Vector3(0,1,0):new THREE.Vector3(c.cosA*c.cosE,c.sinE,-c.sinA*c.cosE);
  const project=point=>{
    if(mode==='front')return{x:point.x,y:-point.y,depth:point.z};
    if(mode==='top')return{x:point.x,y:point.z,depth:point.y};
    // Y-up metres -> right-handed Z-up Anatomy coordinates.
    const value=[point.x,-point.z,point.y],p=technicalProjection.iso(value,options);
    return{x:p[0],y:p[1],depth:technicalProjection.depthOf(value,options)};
  };return{camera,project};
}

function surfaceColor(material,normal,camera) {
  const color=material&&material.color?material.color.clone():new THREE.Color('#a1b5c1').convertSRGBToLinear();
  // Native MeshStandardMaterial colours are already linear. Canvas expects
  // sRGB; writing linear hex values was making the old industrial previews dark.
  if(material&&material.userData&&material.userData.studioColorSpace==='srgb')color.convertSRGBToLinear();
  const roughness=clamp(material&&finite(material.roughness)?material.roughness:.55,.05,1),metalness=clamp(material&&finite(material.metalness)?material.metalness:0,0,1);
  const diffuse=.48+.38*Math.max(0,normal.dot(KEY_LIGHT))+.14*Math.max(0,normal.dot(FILL_LIGHT));
  const half=KEY_LIGHT.clone().add(camera).normalize(),specular=Math.pow(Math.max(0,normal.dot(half)),8+40*(1-roughness))*(.035+.10*metalness)*(1-roughness);
  color.multiplyScalar(diffuse);color.addScalar(specular);if(material&&material.emissive)color.add(material.emissive.clone().multiplyScalar(.18));
  color.r=clamp(color.r,0,1);color.g=clamp(color.g,0,1);color.b=clamp(color.b,0,1);color.convertLinearToSRGB();return '#'+color.getHexString();
}
function topology(entry) {
  const g=entry.geometry,p=entry.position,n=g.attributes.normal,index=g.index,signature=[p.version,index&&index.version,n&&n.version,entry.start,entry.count,JSON.stringify(g.groups||[])].join('|'),previous=TOPOLOGY.get(g);
  if(previous&&previous.signature===signature&&previous.position===p&&previous.index===index&&previous.normals===n){TOPOLOGY.delete(g);TOPOLOGY.set(g,previous);return previous;}
  if(previous){cachedTriangles-=previous.triangles.length;TOPOLOGY.delete(g);}
  const triangles=[],edges=new Map(),vertexKeys=new Map(),point=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const vertexKey=id=>{if(!vertexKeys.has(id)){point.fromBufferAttribute(p,id);vertexKeys.set(id,point.toArray().map(v=>Math.round(v*100000)).join(','));}return vertexKeys.get(id);};
  for(let face=0;face<entry.count;face++){
    const start=entry.start+face*3,ids=[0,1,2].map(i=>index?index.getX(start+i):start+i),group=(g.groups||[]).find(value=>start>=value.start&&start<value.start+value.count);
    a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);const normal=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize(),smooth=new THREE.Vector3();
    if(n)ids.forEach(id=>smooth.add(point.fromBufferAttribute(n,id)));if(!smooth.toArray().every(finite)||smooth.lengthSq()<1e-10)smooth.copy(normal);else smooth.normalize();
    const tri={ids,normal:normal.toArray(),smooth:smooth.toArray(),materialIndex:group?group.materialIndex:0};triangles.push(tri);
    for(let edge=0;edge<3;edge++){const aKey=vertexKey(ids[edge]),bKey=vertexKey(ids[(edge+1)%3]),key=aKey<bKey?aKey+'|'+bKey:bKey+'|'+aKey;if(!edges.has(key))edges.set(key,[]);edges.get(key).push({triangle:face,a:edge,b:(edge+1)%3});}
  }
  const result={signature,position:p,index,normals:n,triangles,edges:Array.from(edges.values())};TOPOLOGY.set(g,result);cachedTriangles+=triangles.length;
  while(cachedTriangles>24000||TOPOLOGY.size>512){const key=TOPOLOGY.keys().next().value,old=TOPOLOGY.get(key);TOPOLOGY.delete(key);cachedTriangles-=old.triangles.length;}return result;
}
function addEdges(faces,edges) {
  faces.forEach(face=>{if(face)face.edges=[];});
  edges.forEach(source=>{
    const adjacent=source.map(edge=>Object.assign({face:faces[edge.triangle]},edge)).filter(edge=>edge.face),visible=adjacent.filter(edge=>edge.face.facing);
    if(!visible.length)return;
    const crease=adjacent.length!==2||visible.length!==adjacent.length||Math.abs(adjacent[0].face.normal.dot(adjacent[1].face.normal))<.70||adjacent[0].face.material!==adjacent[1].face.material;
    if(crease){const edge=visible[visible.length-1];edge.face.edges.push([edge.a,edge.b]);}
  });
}
const BOX_FACES=[[0,1,3],[0,3,2],[4,6,7],[4,7,5],[0,4,5],[0,5,1],[2,3,7],[2,7,6],[0,2,6],[0,6,4],[1,5,7],[1,7,3]];
const BOX_EDGES=(()=>{const values=new Map();BOX_FACES.forEach((ids,triangle)=>{for(let a=0;a<3;a++){const b=(a+1)%3,key=[ids[a],ids[b]].sort().join(':');if(!values.has(key))values.set(key,[]);values.get(key).push({triangle,a,b});}});return Array.from(values.values());})();

/** Project complete source surfaces. Dense individual replacements use a
 * labelled closed envelope; individual triangles are never sampled away. */
function build(meshes,parts=[],turn=0,requestedMode='isometric',options={}) {
  const startTime=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const faceLimit=Math.floor(clamp(finite(options.faces)?options.faces:LIMITS.faces,200,LIMITS.faces)),sourceLimit=Math.floor(clamp(finite(options.sourceFaces)?options.sourceFaces:LIMITS.sourceFaces,200,LIMITS.sourceFaces));
  const meshLimit=Math.floor(Math.min(faceLimit/6,clamp(finite(options.maxMeshes)?options.maxMeshes:LIMITS.meshes,1,LIMITS.meshes))),selectedMeshes=meshes.slice(0,meshLimit),knownSourceTriangles=meshes.sourceTriangles===undefined?meshes.reduce((sum,entry)=>sum+entry.count,0):meshes.sourceTriangles;
  const mode=MODES.includes(requestedMode)?requestedMode:'isometric',{camera,project}=projection(mode),rotation=new THREE.Matrix4().makeRotationY(turn*Math.PI/2);
  const bounds=new THREE.Box3(),partBounds=parts.map(()=>new THREE.Box3()),faces=[];let sourceTriangles=0,usedSource=0,simplifiedMeshes=0;
  const records=selectedMeshes.map(entry=>{
    const matrix=rotation.clone().multiply(entry.matrix),box=new THREE.Box3();
    if(entry.geometry.boundingBox)box.copy(entry.geometry.boundingBox);else{const p=entry.position,cached=BOUNDS.get(entry.geometry);if(cached&&cached.attribute===p&&cached.version===p.version)box.copy(cached.box);else{for(let i=0;i<p.count;i++)box.expandByPoint(new THREE.Vector3().fromBufferAttribute(p,i));BOUNDS.set(entry.geometry,{attribute:p,version:p.version,box:box.clone()});}}
    const worldBox=box.clone().applyMatrix4(matrix);bounds.union(worldBox);sourceTriangles+=entry.count;
    let semantic=parts.findIndex(part=>(part.preferredRoles||[]).includes(entry.role)||(part.preferredNames||[]).includes(entry.mesh.name));if(semantic<0)for(const id of entry.componentIds||[]){semantic=parts.findIndex(part=>(part.componentIds||[]).includes(id));if(semantic>=0)break;}const matches=parts.map((part,index)=>part.jointId?(entry.jointId?entry.jointId===part.jointId:!!part.jointNodeName&&entry.names.includes(part.jointNodeName.toLowerCase())):part.integratedWith?semantic>=0&&parts[semantic].id===part.integratedWith:semantic>=0?index===semantic:(part.roles||[]).includes(entry.role)||(part.match||[]).some(match=>entry.names.includes(String(match).toLowerCase())));return{entry,matrix,box,worldBox,matches,part:matches.findIndex(Boolean)};
  });
  if(bounds.isEmpty())bounds.set(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,1,1));
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),groups=new Map();
  if(mode==='exploded'){
    const semanticGroups=new Set(records.map(record=>record.part)),singleGroup=semanticGroups.size<=1;
    records.forEach(record=>{const group=record.part<0||singleGroup?'mesh:'+record.entry.mesh.uuid+':'+record.entry.instance:'part:'+record.part;if(!groups.has(group))groups.set(group,new THREE.Box3());groups.get(group).union(record.worldBox);record.group=group;});
  }
  const offsets=new Map();let groupIndex=0;
  groups.forEach((box,key)=>{
    const direction=box.getCenter(new THREE.Vector3()).sub(center),angle=groupIndex*Math.PI*(3-Math.sqrt(5)),fan=new THREE.Vector3(Math.cos(angle),((groupIndex%3)-1)*.7,Math.sin(angle));
    if(direction.lengthSq()<1e-8)direction.copy(fan);else direction.normalize().addScaledVector(fan,.55);
    const span=size.clone().max(new THREE.Vector3(.15,.15,.15));direction.normalize().multiply(span).multiplyScalar(.18*(finite(options.explodeAmount)?clamp(options.explodeAmount,0,1):1));offsets.set(key,direction);groupIndex++;
  });
  records.forEach((record,recordIndex)=>{
    const {entry,matches,part}=record,memberships=matches.map((matched,index)=>matched?index:-1).filter(index=>index>=0);let matrix=record.matrix;
    if(mode==='exploded'){
      const direction=offsets.get(record.group);
      matrix=new THREE.Matrix4().makeTranslation(direction.x,direction.y,direction.z).multiply(matrix);
    }
    const box=record.box.clone().applyMatrix4(matrix);matches.forEach((matched,index)=>{if(matched)partBounds[index].union(box);});
    const position=entry.position,normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix);
    let proxy=entry.count+usedSource>sourceLimit,local=[],edges=BOX_EDGES;
    const append=(vertices,material,normal,geometric)=>{
      if(vertices.some(point=>!finite(point.x)||!finite(point.y)||!finite(point.z))||geometric.lengthSq()<1e-16){local.push(null);return;}geometric.normalize();
      const facing=material&&material.side===THREE.DoubleSide||(material&&material.side===THREE.BackSide?geometric.dot(camera)<-1e-7:geometric.dot(camera)>1e-7);
      local.push({points:vertices.map(project),normal:geometric,facing,material,part,parts:memberships,color:surfaceColor(material,normal,camera),opacity:material&&finite(material.opacity)?material.opacity:1});
    };
    if(!proxy){const data=topology(entry);edges=data.edges;data.triangles.forEach(tri=>{
      const material=entry.materials[tri.materialIndex]||entry.materials[0];if(!material||material.visible===false||material.opacity<.2){local.push(null);return;}
      const vertices=tri.ids.map(i=>new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(matrix)),normal=new THREE.Vector3().fromArray(tri.smooth).applyMatrix3(normalMatrix).normalize(),geometric=new THREE.Vector3().fromArray(tri.normal).applyMatrix3(normalMatrix);append(vertices,material,normal,geometric);
    });}
    if(local.filter(face=>face&&face.facing).length+faces.length>faceLimit-(records.length-recordIndex-1)*6)proxy=true;
    if(proxy){local=[];edges=BOX_EDGES;simplifiedMeshes++;const points=boxPoints(record.box,matrix),material=entry.materials.find(Boolean),negative=matrix.determinant()<0;BOX_FACES.forEach(ids=>{const vertices=ids.map(i=>points[i]),normal=new THREE.Vector3().crossVectors(vertices[1].clone().sub(vertices[0]),vertices[2].clone().sub(vertices[0])).normalize();if(negative)normal.negate();append(vertices,material,normal,normal);});}else usedSource+=entry.count;
    addEdges(local,edges);local.filter(face=>face&&face.facing).forEach(face=>{face.depth=face.points.reduce((sum,point)=>sum+point.depth,0)/3;delete face.normal;delete face.material;delete face.facing;faces.push(face);});
  });
  const all=faces.flatMap(face=>face.points),projected=all.length?all:boxPoints(bounds,new THREE.Matrix4()).map(project),xs=projected.map(p=>p.x),ys=projected.map(p=>p.y);
  return{faces:faces.sort((a,b)=>a.depth-b.depth),parts:parts.map((part,index)=>Object.assign({},part,{point:partBounds[index].isEmpty()?null:project(partBounds[index].getCenter(new THREE.Vector3()))})),
    triangleCount:faces.length,capturedSourceTriangles:sourceTriangles,sourceTriangles:knownSourceTriangles,meshCount:records.length,simplifiedMeshes,truncatedMeshes:(meshes.truncatedMeshes||0)+meshes.length-records.length,omittedInstances:(meshes.omittedInstances||0)+meshes.length-records.length,mode,limits:{faces:faceLimit,sourceFaces:sourceLimit,meshes:meshLimit},projectionSource:'Anatomy / native geometry',buildMilliseconds:(typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-startTime,bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)}};
}

function paint(context,model,offset={x:0,y:0},highlight) {
  model.faces.forEach(face=>{
    if(highlight!==undefined&&![face.part,...(face.parts||[])].some(index=>model.parts[index]&&model.parts[index].name===highlight))return;
    const points=face.points.map(point=>{const p=model.project(point);return{x:p.x+offset.x,y:p.y+offset.y};});context.beginPath();points.forEach((point,i)=>context[i?'lineTo':'moveTo'](point.x,point.y));context.closePath();
    context.globalAlpha=highlight!==undefined?1:face.opacity;context.fillStyle=highlight!==undefined?'rgba(85,215,242,.48)':face.color;context.fill();
    if(highlight===undefined){
      // Opaque same-fill stroke closes Canvas antialias seams, without drawing
      // a triangulation grid across rounded shells and industrial cylinders.
      if(face.opacity>=.99){context.strokeStyle=face.color;context.lineWidth=.45;context.stroke();}
      if(face.edges&&face.edges.length){context.beginPath();face.edges.forEach(([a,b])=>{context.moveTo(points[a].x,points[a].y);context.lineTo(points[b].x,points[b].y);});context.strokeStyle='#0c1924';context.lineWidth=.65;context.stroke();}
    }
  });context.globalAlpha=1;
}
function clearCache(){TOPOLOGY.clear();cachedTriangles=0;}
export default {capture,build,paint,clearCache,MODES,LIMITS};
