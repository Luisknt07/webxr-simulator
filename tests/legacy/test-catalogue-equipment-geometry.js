'use strict';
// Real native bodies, material banks, support triangles and authored actor IDs.
// Static geometry does not establish headset FPS or a machine's process physics.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const catalog=require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs');
const visual=require('../../modules/logistica-industrial/functions/equipamiento/runtime/EquipmentGeometry.cjs');
const surfaces=require('../../modules/logistica-industrial/functions/equipamiento/runtime/EquipmentSurfaces.cjs');
const schema=require('../../modules/logistica-industrial/contracts/behaviors.js');
const resolved=require('../support/load-robot-prefabs.js')(THREE);
const code=fs.readFileSync(path.join(__dirname,'../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const native=new Function('THREE','behaviorSchema','require',code+'\nreturn {createIndustrialPrefab,decorateIndustrialEquipment};')(THREE,schema,resolved.resolve);
const near=(a,b,why)=>assert(Math.abs(a-b)<2e-5,(why||'Values differ')+': '+a+' / '+b);
const fixture=id=>{const def=catalog.definition(id),cfg=catalog.normalize(id),layout=catalog.layout(id,cfg);return{def,cfg,layout,root:visual.createEquipmentGeometry(def,cfg,{THREE,layout})};};
const parts=root=>{const out=[];root.traverse(n=>{if(n.isMesh)out.push(n);});return out;};
const budget=root=>{let triangles=0,draws=0;root.traverse(n=>{if(n.isMesh){triangles+=(n.geometry.index?n.geometry.index.count:n.geometry.attributes.position.count)/3;draws+=(Array.isArray(n.material)?n.material:[n.material]).length;}});return{triangles,draws};};
const labels=root=>parts(root).flatMap(n=>n.userData.equipmentSourceParts||[]);
const summary=[];
for(const def of catalog.DEFINITIONS){
 const cfg=catalog.normalize(def.id),before=JSON.stringify(cfg),layout=catalog.layout(def.id,cfg),root=visual.createEquipmentGeometry(def,cfg,{THREE,layout});
 assert.equal(JSON.stringify(cfg),before,'Geometry cannot mutate machine configuration.');
 if(!root){assert(visual.keepNative(def)||def.role==='monitor','Only an explicit native body or workspace may omit a replacement.');continue;}
 const cost=budget(root);summary.push({id:def.id,...cost});assert(cost.triangles>20&&cost.triangles<=35000&&cost.draws<=40,def.id+': bounded web/Quest body budget.');
 for(const mesh of parts(root)){
  assert(mesh.userData.equipmentComponentId.startsWith(def.id+'.'),'Every actual surface belongs to its machine study component.');
  const g=mesh.geometry;assert(g.index&&g.attributes.normal&&g.attributes.uv);assert(g.attributes.position.array.every(Number.isFinite));
  for(let i=0;i<g.attributes.normal.count;i++)near(Math.hypot(g.attributes.normal.getX(i),g.attributes.normal.getY(i),g.attributes.normal.getZ(i)),1,def.id+': manufactured normals');
  assert.equal(mesh.material.userData.studioColorSpace,'linear');assert(mesh.material.userData.industrialMaterialRole);
 }
 visual.disposeGeometry(root);
}
assert(summary.length>100,'The new catalogue must have genuine native geometry beyond a few sample templates.');
for(const [id,required] of [
 ['equipment.machine.cnc-lathe',['Plato del torno','Mordaza del plato','Guía de bancada']],
 ['equipment.machine.machining-center',['Husillo','Carrusel portaherramientas']],
 ['equipment.machine.injection-molder',['Camisa plastificadora','Banda calefactora','Columna de cierre','Molde']],
 ['equipment.machine.press-brake',['Punzón lineal','Matriz V']],
 ['equipment.machine.tank-mixer',['Depósito de proceso','Eje del agitador','Paleta mezcladora']],
 ['equipment.packaging.carton-sealer',['Rollo de cinta','Cabezal de encintado','Plegador de solapas']],
 ['equipment.packaging.stretch-wrapper',['Mesa giratoria','Columna de elevación','Bobina de film']],
 ['equipment.packaging.print-apply',['Impresora térmica','Bobina de etiquetas','Placa aplicadora']],
 ['equipment.tool.magnet',['Electroimán','Cara polar']],
 ['equipment.product.ibc',['Depósito IBC','Válvula de salida']]
]){
 const f=fixture(id),names=labels(f.root);required.forEach(label=>assert(names.includes(label),id+': actual '+label+' surface, not a renamed generic housing.'));visual.disposeGeometry(f.root);
}

// The exact path shared with the flow controller lies on the top-facing belt.
const spiral=fixture('equipment.transport.spiral');assert.deepEqual(spiral.root.userData.catalogueSurfacePath,spiral.layout.path.points);
const deck=parts(spiral.root).filter(n=>n.userData.equipmentComponentId.endsWith('.surface'));
spiral.root.updateMatrixWorld(true);
for(let i=1;i<spiral.layout.path.points.length-1;i+=5){const p=spiral.layout.path.points[i],ray=new THREE.Raycaster(new THREE.Vector3(p[0],p[1]+.04,p[2]),new THREE.Vector3(0,-1,0),0,.08),hits=ray.intersectObjects(deck,false);assert(hits.length,'The live spiral load path must have a real supporting triangle.');near(hits[0].point.y,p[1]);}
visual.disposeGeometry(spiral.root);

// Native actor slots/panel IDs remain stable while old body buffers are retired.
const f=fixture('equipment.machine.cnc-lathe'),root=native.createIndustrialPrefab('processor'),panel=root.children[2],controls=panel.children.slice();
const old=root.children[0],before=budget(root);let retired=0;old.traverse(n=>{if(n.geometry)n.geometry.addEventListener('dispose',()=>retired++);});
assert(visual.applyEquipmentGeometry(root,f.def,f.cfg,{THREE,layout:f.layout}));assert.strictEqual(root.children[2],panel);assert.deepEqual(panel.children,controls);assert(retired>0,'Retire the unused generic body instead of keeping a hidden duplicate.');assert(!root.children.includes(old));assert.equal(root.children[0].children.length,0);assert.equal(root.children.filter(n=>n.userData.catalogueGeometryBody).length,1);
assert.equal(visual.applyEquipmentGeometry(root,f.def,f.cfg,{THREE,layout:f.layout}),false,'Unchanged presentation does not allocate another body.');
const changed={...f.cfg,length:f.cfg.length+.25};assert(visual.applyEquipmentGeometry(root,f.def,changed,{THREE,layout:catalog.layout(f.def.id,changed)}));assert.equal(root.children.filter(n=>n.userData.catalogueGeometryBody).length,1);assert.strictEqual(root.children[2],panel);visual.disposeGeometry(f.root);visual.disposeGeometry(root);

// Manufactured defaults are not blanket metallic paint, and never alter a TCP.
for(const [role,color]of [['paint','#466574'],['rubber','#222d34'],['steel','#b8c1c7']]){const m=surfaces.createSurface(THREE,'Test '+role,color,{},role);assert(m.color.equals(new THREE.Color(color).convertSRGBToLinear()));if(role==='steel')assert(m.metalness>.75);else assert(m.metalness<.15);if(m.map)m.map.dispose();m.dispose();}
for(const [kind,variant]of [['conveyor','roller-motor'],['source',undefined],['processor','process'],['palletQueue','selective'],['product','box-medium'],['sensor',undefined],['plc',undefined]]){
 const root=native.createIndustrialPrefab(kind,variant==='process'?undefined:variant);let tagged=0;root.traverse(n=>{if(n.userData.equipmentComponentId)tagged++;});assert(tagged>0,kind+': native semantic component identities exist.');
 if(kind==='conveyor'){assert.equal(root.children.length,11);assert(root.children[6].userData.editorDefaultBehaviors.some(b=>b.type==='automation'));}
 if(kind==='processor'){assert.equal(root.children.length,4);assert(root.children[3].userData.industrialProcessorHead);}
 visual.disposeGeometry(root);
}
console.log('Catalogue equipment geometry: '+summary.length+' explicit bodies, distinct mechanical assemblies, native actor/control preservation, buffer retirement, linear PBR roles, semantic components and exact shared spiral support passed.');
console.log('Maximum new body: '+Math.max(...summary.map(x=>x.triangles))+' triangles / '+Math.max(...summary.map(x=>x.draws))+' material draws (before native panel; no headset FPS claim).');
