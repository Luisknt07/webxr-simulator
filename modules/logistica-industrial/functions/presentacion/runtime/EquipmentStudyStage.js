import * as THREE from 'three';
import industrialLighting from '../../../../../packages/render-three/schema/industrial-lighting.js';

// The technical view renders the complete native meshes with an orthographic
// camera. It never substitutes dense articulated links with bounding boxes.
export function visibleBounds(rows){
 const box=new THREE.Box3();
 for(const row of rows){const mesh=row.mesh;let visible=mesh.visible;for(let p=mesh.parent;visible&&p;p=p.parent)visible=p.visible;if(!visible||!mesh.geometry)continue;if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();if(mesh.geometry.boundingBox)box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));}
 return box;
}
export function fitTechnicalCamera(camera,box,aspect,view='isometric'){
 if(box.isEmpty())return null;
 const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),span=Math.max(.1,size.length());
 const directions={front:[0,0,1],rear:[0,0,-1],side:[1,0,0],top:[0,1,0],isometric:[-.8,.52,.8]},direction=new THREE.Vector3().fromArray(directions[view]||directions.isometric).normalize();
 camera.up.set(0,1,0);if(view==='top')camera.up.set(0,0,-1);camera.position.copy(center).addScaledVector(direction,span*2);camera.lookAt(center);camera.updateMatrixWorld(true);
 const inverse=new THREE.Matrix4().getInverse(camera.matrixWorld),projected=new THREE.Box3();for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(inverse));
 const halfHeight=Math.max(.03,(projected.max.y-projected.min.y)/2,(projected.max.x-projected.min.x)/Math.max(.1,aspect)/2)*1.08;
 camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;camera.top=halfHeight;camera.bottom=-halfHeight;camera.near=Math.max(.001,span/1000);camera.far=span*6+10;camera.zoom=1;camera.updateProjectionMatrix();return center;
}
export function makeStudyReflections(renderer){
 if(!renderer.capabilities||!THREE.PMREMGenerator)return null;
 const room=industrialLighting.reflectionRoom(THREE,false),generator=new THREE.PMREMGenerator(renderer);let target;
 try{target=generator.fromScene(room.scene,.07,.1,60);}finally{generator.dispose();room.dispose();}
 return target;
}
export function createTechnicalSurfaces(rows){
 const materials=[],edgeGeometries=[],lineMaterial=new THREE.LineBasicMaterial({color:0x16343d,transparent:true,opacity:.48,depthWrite:false}),edges=[];let edgeVertices=0;
 for(const row of rows){
  row.technicalMaterials=row.materials.map(original=>{const material=original.clone();if(material.roughness!==undefined)material.roughness=.92;if(material.metalness!==undefined)material.metalness=.08;if(material.envMapIntensity!==undefined)material.envMapIntensity=.55;materials.push(material);return material;});
  if(row.mesh.userData.studyAccessoryLabel||row.materials.some(m=>m.transparent||m.opacity<.95))continue;
  const geometry=new THREE.EdgesGeometry(row.mesh.geometry,38),count=geometry.attributes.position.count;
  if(edgeVertices+count>180000){geometry.dispose();continue;}edgeVertices+=count;edgeGeometries.push(geometry);
  const line=new THREE.LineSegments(geometry,lineMaterial);line.name='Contornos técnicos del componente';line.renderOrder=2;line.visible=false;row.mesh.add(line);edges.push(line);
 }
 return {edges,edgeVertices,setTechnical(enabled){for(const row of rows)row.mesh.material=Array.isArray(row.mesh.material)?(enabled?row.technicalMaterials:row.materials):(enabled?row.technicalMaterials[0]:row.materials[0]);for(const edge of edges)edge.visible=enabled;},dispose(){for(const edge of edges)if(edge.parent)edge.parent.remove(edge);edgeGeometries.forEach(g=>g.dispose());lineMaterial.dispose();materials.forEach(m=>m.dispose());}};
}
export function stageStats(rows){
 let meshes=0,triangles=0;for(const row of rows)if(row.mesh.visible){meshes++;const g=row.mesh.geometry;triangles+=(g.index?g.index.count:g.attributes.position.count)/3;}
 return {renderer:'orthographic-native',meshes,triangles,envelopes:0};
}
