'use strict';
// Exercise generated production surfaces rather than a golden mesh snapshot.
const assert=require('node:assert/strict'),THREE=require('three');
const vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles');
const prefabs=require('../support/load-vehicle-prefabs')(THREE);
const rounded=v=>v.toArray().map(n=>Math.round(n*1e6)).join(','),point=(g,i)=>new THREE.Vector3().fromBufferAttribute(g.attributes.position,g.index?g.index.getX(i):i);
function closedSurface(g,label){
 for(const [name,attribute]of Object.entries(g.attributes))assert.equal(attribute.count,g.attributes.position.count,label+' '+name+' accessor must cover every position, including added caps');
 const count=g.index?g.index.count:g.attributes.position.count,edges=new Map(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let volume=0;
 for(let i=0;i<count;i+=3){a.copy(point(g,i));b.copy(point(g,i+1));c.copy(point(g,i+2));const area=b.clone().sub(a).cross(c.clone().sub(a)).length();assert(area>1e-11,label+' has a degenerate bevel triangle');volume+=a.dot(b.clone().cross(c))/6;
  for(const [start,end] of [[a,b],[b,c],[c,a]]){const s=rounded(start),e=rounded(end),key=[s,e].sort().join('|');let row=edges.get(key);if(!row){row={count:0,balance:0};edges.set(key,row);}row.count++;row.balance+=s<e?1:-1;}
 }
 assert(volume>0,label+' must face outward');for(const edge of edges.values())assert(edge.count===2&&edge.balance===0,label+' must have one joined closed surface');
 const normal=g.attributes.normal;for(let i=0;i<normal.count;i++){const n=new THREE.Vector3().fromBufferAttribute(normal,i);assert(n.toArray().every(Number.isFinite));assert(Math.abs(n.length()-1)<1e-5,label+' normals must stay unit length');}
}
let accessors=0;for(const detail of ['low','balanced','high'])for(const definition of vehicles.VARIANTS){const root=prefabs.createVehicle({...definition.preset,detail});root.traverse(node=>{if(!node.geometry)return;const g=node.geometry,p=g.attributes.position;for(const [name,attribute]of Object.entries(g.attributes)){assert.equal(attribute.count,p.count,definition.id+'/'+detail+'/'+node.name+' '+name+' covers all vertices');accessors++;}if(g.index)for(let i=0;i<g.index.count;i++)assert(g.index.getX(i)<p.count,'Every indexed attribute fetch is in range');});}
const metrics=[];
for(const detail of ['low','balanced','high']){
 const root=prefabs.createVehicle({detail}),rig=root.userData.vehicleRig,d=rig.detail,container=new THREE.Group();
 const size=[.8,.32,.41],sample=d.solid('Prueba de fundición',size,'frame',container,[0,0,0],.025),g=sample.geometry;
 closedSurface(g,detail+' rounded casting');assert.equal(g.userData.manufacturedProfile,'rounded-distance-field');
 const bounds=g.boundingBox,half=size.map(v=>v/2),r=g.userData.manufacturedRadius;
 for(let i=0;i<3;i++){assert(Math.abs(bounds.min.getComponent(i)+half[i])<1e-6);assert(Math.abs(bounds.max.getComponent(i)-half[i])<1e-6);}
 const p=g.attributes.position,n=g.attributes.normal;
 for(let i=0;i<p.count;i++){const at=new THREE.Vector3().fromBufferAttribute(p,i),core=at.clone();for(let k=0;k<3;k++)core.setComponent(k,THREE.Math.clamp(core.getComponent(k),-half[k]+r,half[k]-r));const delta=at.clone().sub(core);assert(Math.abs(delta.length()-r)<1e-6,'Rounded edge stays on its one exact casting surface');assert(delta.normalize().dot(new THREE.Vector3().fromBufferAttribute(n,i))>.9999,'No diagonal or inverted bevel shading');}
 closedSurface(rig.counterweight.geometry,detail+' compound counterweight');
 const cap=rig.counterweight.geometry,position=cap.attributes.position,normal=cap.attributes.normal,sections=cap.userData.manufacturedSections,sideCount=sections.length*4*(3+d.level),bottom=sections[0][0],top=sections[sections.length-1][0];
 for(let i=sideCount;i<position.count;i++){const y=position.getY(i),expected=Math.abs(y-bottom)<1e-6?-1:Math.abs(y-top)<1e-6?1:0;assert(expected,'Cap vertices remain on the intended end face');assert(Math.abs(normal.getX(i))<1e-6&&Math.abs(normal.getZ(i))<1e-6&&normal.getY(i)*expected>.99999,'Every cap normal faces outward on its own plane');}
 let triangles=0,draws=0;root.traverse(node=>{if(node.geometry){triangles+=(node.geometry.index?node.geometry.index.count:node.geometry.attributes.position.count)/3*(node.isInstancedMesh?node.count:1);draws++;}});metrics.push({detail,triangles,draws});
 const components=new Set();root.traverse(node=>{if(node.userData.equipmentComponentId)components.add(node.userData.equipmentComponentId);});for(const id of ['vehicle.forks','vehicle.mast','vehicle.hydraulics','vehicle.wheels','vehicle.controls','vehicle.steering','vehicle.seat','vehicle.counterweight','vehicle.power'])assert(components.has(id),'The actual functional assembly exposes '+id);
 const power=[];root.traverse(node=>{if(node.isMesh&&node.userData.industrialComponents&&node.userData.equipmentComponentId==='vehicle.power')power.push(node);});assert(power.length,'Presentation batches keep the service module available for inspection');
}
// Tread-block local Y must point radially away from its real wheel axle.
// The previous -angle rotated most blocks away from the tangent plane.
const truck=prefabs.createVehicle(vehicles.defaults('forklift-ic')),rig=truck.userData.vehicleRig;
for(const wheel of rig.wheels){const tread=wheel.roll.children.find(n=>n.userData.industrialComponents&&n.userData.industrialComponents.includes('Taco de tracción'));assert(tread,'IC tyres use staggered pneumatic blocks');const geo=tread.geometry;closedSurface(geo,'Batched tyre blocks');
 const p=geo.attributes.position,n=geo.attributes.normal,ranges=tread.userData.industrialComponentRanges.filter(row=>row.name==='Taco de tracción');assert(ranges.length>20);for(const range of ranges){const at=range.start;assert.equal(range.count,36);const center=new THREE.Vector3();for(let i=at;i<at+36;i++)center.add(new THREE.Vector3().fromBufferAttribute(p,i));center.divideScalar(36);const radial=new THREE.Vector3(0,center.y,center.z).normalize(),outward=new THREE.Vector3().fromBufferAttribute(n,at+12);assert(outward.dot(radial)>.94,'Each real tyre block faces radially outward and rests tangent to the tread');}
}
const fresh=prefabs.createVehicle({wear:0,frameColor:'#18394f'}),worn=prefabs.createVehicle({wear:.7,frameColor:'#18394f'}),a=fresh.userData.vehicleRig.resources.materials,b=worn.userData.vehicleRig.resources.materials;
assert(a.frame.color.equals(new THREE.Color('#18394f').convertSRGBToLinear()),'Authored paint color remains authoritative');assert(a.frame.metalness<.05,'Coated paint remains a dielectric');assert(a.steel.metalness>.7);assert(a.frame.roughnessMap===a.frame.bumpMap,'One packed linear image supplies both channels');assert.equal(a.frame.bumpMap.image.width,128);assert.equal(a.frame.bumpMap.encoding,THREE.LinearEncoding);assert(a.frame.bumpScale<=.0002,'Microscopic finish does not turn a casting into a dented cartoon');assert.equal(a.rubber.map,null);assert.equal(a.seat.map,null);
let freshLuma=0,wornLuma=0;for(let i=0;i<a.frame.map.image.data.length;i+=4){freshLuma+=a.frame.map.image.data[i];wornLuma+=b.frame.map.image.data[i];assert(b.frame.map.image.data[i]>210,'Localized wear retains continuous paint rather than fake black holes');}assert(wornLuma<freshLuma);assert.notEqual(a.frame.map,b.frame.map,'Independent equipment never share mutable authored finishes');
const maps=new Set();fresh.traverse(node=>{for(const m of (Array.isArray(node.material)?node.material:[node.material]).filter(Boolean))for(const v of Object.values(m))if(v&&v.isTexture)maps.add(v);});let bytes=0;for(const map of maps)bytes+=map.image.data.byteLength;assert.equal(maps.size,3);assert(bytes*4/3<1024*1024,'All mipmapped finish/label texels fit one MiB per vehicle');
console.log('Manufactured vehicle surfaces: '+accessors+' equal-count attribute accessors across 39 variants/qualities, closed outward exact-envelope castings, complete cap normals, actual semantic components and bounded budgets passed '+JSON.stringify(metrics)+'.');
