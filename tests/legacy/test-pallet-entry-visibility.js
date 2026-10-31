'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const equipment=require('../../modules/logistica-industrial/functions/flujo-materiales/schema/product-equipment.js');
const sources=require('../../modules/logistica-industrial/functions/flujo-materiales/schema/productSources.js');
const prefab=require('../support/load-product-prefabs.js')(THREE);
const source=fs.readFileSync(path.resolve(__dirname,'../../modules/logistica-industrial/functions/flujo-materiales/runtime/ProductPrefabs.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const baseline=new Function('THREE','productEquipment','productSources',source.replace('  palletEntryContrast(root, b, {w, d, height, top, bottom, count, boardDepth, pockets});','')+'\nreturn {createProduct,createCargoVisual};')(THREE,equipment,sources);
const dispose=root=>{const geometries=new Set(),materials=new Set(),maps=new Set();root.traverse(n=>{if(n.geometry)geometries.add(n.geometry);if(n.material){materials.add(n.material);if(n.material.map)maps.add(n.material.map);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());maps.forEach(t=>t.dispose());};
function verifyVisual(object,plain,label){
  object.updateMatrixWorld(true);plain.updateMatrixWorld(true);
  assert.deepEqual(object.userData.forkPockets,plain.userData.forkPockets,label+': entry metadata remains exact');
  assert.deepEqual(object.userData.sourceProduct,plain.userData.sourceProduct,label+': mass, dimensions and load identity remain exact');
  const paths=root=>{const result=[];const visit=(node,path)=>{if(node.isMesh&&!node.userData.palletEntryMarking)result.push({path,name:node.name,role:node.userData.industrialMaterialRole});node.children.forEach((child,index)=>visit(child,path+'.'+index));};visit(root,'root');return result;};
  assert.deepEqual(paths(object),paths(plain),label+': original physical mesh paths remain stable; decoration is appended');
  const box=new THREE.Box3().setFromObject(object),before=new THREE.Box3().setFromObject(plain);
  assert(box.min.distanceTo(before.min)<1e-7&&box.max.distanceTo(before.max)<1e-7,label+': exact physical envelope');
  const marked=[];object.traverse(n=>{if(n.userData.palletEntryMarking)marked.push(n);});
  assert.equal(marked.length,2,label+': two bounded decorative material batches');
  let baselineMarked=0;plain.traverse(n=>{if(n.userData.palletEntryMarking)baselineMarked++;});assert.equal(baselineMarked,0);
  const ray=new THREE.Raycaster(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  let triangles=0;
  marked.forEach(mesh=>{
    assert(mesh.material.depthTest&&!mesh.material.transparent&&mesh.material.opacity===1);
    assert(mesh.userData.editorRuntimeHelper&&mesh.userData.editorCollisionDisabled&&!mesh.castShadow);
    const positions=mesh.geometry.attributes.position,normals=mesh.geometry.attributes.normal,nm=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for(let i=0;i<positions.count;i+=3){
      a.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(positions,i+1).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(positions,i+2).applyMatrix4(mesh.matrixWorld);
      const center=a.clone().add(b).add(c).multiplyScalar(1/3);normal.fromBufferAttribute(normals,i).applyMatrix3(nm).normalize();
      ray.set(center.clone().addScaledVector(normal,.002),normal.clone().negate());ray.near=0;ray.far=.004;
      const hits=ray.intersectObject(plain,true);assert(hits.some(hit=>Math.abs(hit.distance-.002)<.00002),label+': every paint triangle rests on an existing solid face, never across a hole');triangles++;
    }
  });
  assert(triangles<240,label+': bounded marking triangle cost');
  const pockets=object.userData.forkPockets;
  for(const axis of pockets.approachAxes)for(const center of axis==='z'?pockets.centersX:pockets.centersZ){
    const across=axis==='z'?'x':'z',width=axis==='z'?pockets.widthX:pockets.widthZ;
    const opening=new THREE.Box3(new THREE.Vector3(box.min.x,pockets.minY+.001,box.min.z),new THREE.Vector3(box.max.x,pockets.maxY-.001,box.max.z));
    opening.min[across]=center-width/2+.001;opening.max[across]=center+width/2-.001;
    object.traverse(mesh=>{if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,i+1).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,i+2).applyMatrix4(mesh.matrixWorld);assert(!opening.intersectsTriangle(new THREE.Triangle(a,b,c)),label+': both actual entry axes stay physically open');}});
  }
}
for(const [variant,config]of [
  ['pallet-euro',{}],['pallet-industrial',{}],['pallet-plastic',{}],
  ['pallet-loaded',{height:.72,units:4,mass:33}],
  ['pallet-loaded',{palletType:'industrial-1200x1000',width:1.2,depth:1,height:.8,units:4}],
  ['pallet-loaded',{palletType:'half-800x600',width:.8,depth:.6,height:.8,units:2}]
]){const object=prefab.createProduct(variant,config),plain=baseline.createProduct(variant,config);verifyVisual(object,plain,variant+' '+(config.palletType||''));dispose(object);dispose(plain);}
const spec={id:'entry-visibility',name:'Carga',type:'box',variant:'box-small',width:.3,depth:.3,height:.25,mass:2,color:'#b98d53'},load={loadMode:'pallet',palletType:'euro-1200x800',palletMaterial:'wood',palletColumns:2,palletRows:2,palletLayers:1};
const cargo=prefab.createCargoVisual(spec,load),plainCargo=baseline.createCargoVisual(spec,load);verifyVisual(cargo,plainCargo,'Source-generated Euro pallet');dispose(cargo);dispose(plainCargo);

const {fixture}=require('./test-warehouse-rack-runtime');
const realFixture=fs.readFileSync(path.resolve(__dirname,'test-conveyor-mechanisms.js'),'utf8');
const realRequire=require('node:module').createRequire(path.resolve(__dirname,'test-conveyor-mechanisms.js'));
const {setup:realSetup}=new Function('require','__dirname',realFixture.slice(0,realFixture.indexOf('async function run()'))+'\nreturn {setup};')(realRequire,__dirname);
const f=fixture('selective',{},{},{setup:realSetup,beforeStart(f){
  f.authored=f.document.addPrefab('hall','product','pallet-loaded');
  f.document.setBehaviors(f.authored,f.document.getBehaviors(f.authored).map(config=>config.type==='product'?Object.assign({},config,{height:.72,units:4,mass:33,sourceId:''}):config));
  f.document.setTransform(f.authored,{position:[10,0,0]});
}}),api=f.runtime.palletQueueRuntime,product=f.runtime.sourceRuntime.materialize(f.sourceRecord),id=api.palletIdentity(product),entry=product.sourceEntry;
assert(api.assignLocation(f.rackRecord,{locationCode:f.stock.rack.layout.cells[0].code,palletId:id}));
function verifyLabel(p,loaded){
  api.syncIdentification(true);const state=api.identificationLabels.get(p.object);assert(state&&state.root.userData.palletIdentificationAboveEntries);
  p.object.updateWorldMatrix(true,true);const inv=new THREE.Matrix4().getInverse(p.object.matrixWorld),bounds=new THREE.Box3();
  state.root.traverse(n=>{if(!n.geometry)return;if(!n.geometry.boundingBox)n.geometry.computeBoundingBox();bounds.union(n.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,n.matrixWorld)));});
  let pockets=p.object.userData.forkPockets,anchors=p.object.userData.palletIdentificationAnchors;
  p.object.traverse(n=>{if(!pockets&&n.userData.forkPockets)pockets=n.userData.forkPockets;if(!anchors&&n.userData.palletIdentificationAnchors)anchors=n.userData.palletIdentificationAnchors;});
  assert(pockets);assert(bounds.min.y>=pockets.maxY+.001,'ID and address do not mask either entry');
  if(loaded){
    assert(bounds.min.y>=pockets.top/.74+.01,'Loaded-pallet tag is on the cargo above the complete base');
    assert((anchors||[]).some(face=>bounds.min.x>=face.centerX-face.width/2-.001&&bounds.max.x<=face.centerX+face.width/2+.001&&bounds.min.y>=face.minY&&bounds.max.y<=face.maxY+.001&&Math.abs(state.root.position.z-face.frontZ-.005)<.001),'The complete plate fits an actual cargo face, not air between boxes');
  }
  else assert(bounds.max.y<=p.bounds.max.y+.001,'Empty-pallet tag fits the solid deck edge without a floating placard');
  assert(bounds.min.x>=p.bounds.min.x-.001&&bounds.max.x<=p.bounds.max.x+.001);
  const old=state.root;for(let i=0;i<30;i++)api.syncIdentification(true);assert.equal(api.identificationLabels.get(p.object).root,old,'Repeated reads do not allocate new plates');
  return state;
}
verifyLabel(product,true);assert.equal(product.sourceEntry,entry);assert.equal(entry.ownerId,f.sourceRecord.id);
const authoredProduct=Array.from(f.runtime.products.values()).find(p=>p.record&&p.record.id===f.authored.userData.editorId);assert(authoredProduct,'Real SceneDocument authored product must exist');
assert.equal(authoredProduct.object.userData.forkPockets,undefined,'This regression exercises the editor-owned wrapper, not a bare prefab');
authoredProduct.object.userData.sourcePalletId=authoredProduct.record.id;verifyLabel(authoredProduct,true);
const partialLoad=prefab.createProduct('pallet-loaded',{height:.72,units:4,mass:33});partialLoad.userData.sourcePalletId='partial-front-row';f.scene.add(partialLoad);partialLoad.updateMatrixWorld(true);
const partialProduct={object:partialLoad,bounds:new THREE.Box3().setFromObject(partialLoad)};f.runtime.products.set('partial-front-row',partialProduct);const partialState=verifyLabel(partialProduct,true);
assert(partialState.root.position.x<-.2,'An incomplete front row places its tag on the real offset carton instead of across empty pallet width');
api.removeIdentification(partialLoad);f.runtime.products.delete('partial-front-row');f.scene.remove(partialLoad);dispose(partialLoad);
const empty=prefab.createProduct('pallet-euro');empty.userData.sourcePalletId='empty-entry-test';f.scene.add(empty);empty.updateMatrixWorld(true);
const emptyProduct={object:empty,bounds:new THREE.Box3().setFromObject(empty)};f.runtime.products.set('empty-entry-test',emptyProduct);const emptyState=verifyLabel(emptyProduct,false);
let disposals=0;emptyState.root.traverse(n=>{if(n.geometry)n.geometry.addEventListener('dispose',()=>disposals++);});api.removeIdentification(empty);assert(disposals>0&&!emptyState.root.parent);f.runtime.products.delete('empty-entry-test');f.scene.remove(empty);dispose(empty);f.runtime.stop();assert.equal(api.identificationLabels.size,0);
console.log('Pallet entry visibility: two bounded solid-face paint batches, both real axes open, exact envelopes/custody/metadata, raised non-obstructing tags and cleanup passed.');
