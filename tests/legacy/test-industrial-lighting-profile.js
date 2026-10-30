'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const industrialLighting=require('../../packages/render-three/schema/industrial-lighting.js'),schema=require('../../packages/project-model/shared/studio-document.js');
const source=fs.readFileSync(path.resolve(__dirname,'../../packages/render-three/world/SceneEnvironment.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class SceneEnvironment','return class SceneEnvironment');
const industrialSurfaces=require('../../packages/render-three/schema/industrial-surfaces.js');
const Environment=new Function('THREE','schema','industrialLighting','industrialSurfaces',source)(THREE,schema,industrialLighting,industrialSurfaces);
const scene=new THREE.Scene(),root=new THREE.Group(),geometry=new THREE.BoxBufferGeometry(),material=new THREE.MeshStandardMaterial({color:'#56636b'}),roof=new THREE.Mesh(geometry,material);
roof.name='CEDI · RV cubierta industrial cerrada';root.add(roof);scene.add(root);
const sun=new THREE.DirectionalLight('#eeffff',1),fill=new THREE.DirectionalLight('#fff0ee',.3);sun.name='sun';fill.name='fillLight';scene.add(sun,fill);
const renderer={toneMapping:THREE.NoToneMapping,toneMappingExposure:1,shadowMap:{enabled:false,type:THREE.BasicShadowMap},xr:{isPresenting:false}};
const config=Object.assign(schema.defaultEnvironment('hall'),{sky:'color',sunIntensity:.6,ambientIntensity:.25,exposure:.87,shadows:true,renderQuality:'balanced'}),authored=JSON.stringify(config);
const document={studio:{environments:[config]},additions:new Map([['roof',{roomId:'hall',object:roof}]]),getRoot:()=>root};
const editor={roomId:'hall',document,hooks:{renderScene:scene},ctx:{renderer},changeVersion:0};
const environment=new Environment(editor);environment.sync();const bounce=environment.interiorFill;
assert(bounce.isHemisphereLight);assert.equal(bounce.intensity,.55);assert.equal(fill.intensity,0);assert.equal(fill.visible,false);assert.equal(sun.intensity,1.10);assert.equal(renderer.toneMappingExposure,1);
assert.equal(scene.children.filter(object=>object.isLight&&object.intensity>0).length,2,'Only the key and one broad fill remain active.');
assert.equal(scene.children.filter(object=>object.isLight&&object.castShadow).length,1,'The interior fill never adds another shadow map.');
assert.equal(environment.stats.indoorLightingProfile,'industrial-neutral');assert.equal(JSON.stringify(config),authored);assert.equal(roof.material,material);
for(let i=0;i<60;i++)environment.sync();assert.equal(environment.interiorFill,bounce);assert.equal(scene.children.filter(object=>object.isHemisphereLight).length,1);
root.visible=false;environment.sync();assert.equal(bounce.parent,null);root.visible=true;environment.sync();assert.equal(bounce.parent,scene,'A room made visible after asynchronous hydration reactivates its interior fill without an authoring edit.');
editor.roomId='sound';environment.sync();assert.equal(bounce.parent,null);assert.equal(fill.intensity,.3);assert.equal(fill.visible,true);assert.equal(sun.intensity,1);assert.equal(renderer.toneMappingExposure,1);assert.equal(renderer.toneMapping,THREE.NoToneMapping);
editor.roomId='hall';environment.sync();assert.equal(environment.interiorFill,bounce);assert.equal(bounce.parent,scene);
config.sunIntensity=2;config.ambientIntensity=.3;config.exposure=1.12;environment.sync();assert.equal(sun.intensity,2);assert.equal(bounce.intensity,.3);assert.equal(renderer.toneMappingExposure,1.12,'Custom light controls remain authored, outside the two corrected legacy recipes.');
environment.dispose();assert.equal(bounce.parent,null);assert.equal(fill.intensity,.3);geometry.dispose();material.dispose();
for(const values of [{sunIntensity:.6,ambientIntensity:.25,exposure:.87},{sunIntensity:.85,ambientIntensity:.15,exposure:.9}]){
 const original={...values},resolved=industrialLighting.profile(original,true);assert.equal(resolved.exposure,1);assert.equal(resolved.sunIntensity,1.10);assert.equal(resolved.ambientIntensity,.55);assert.deepEqual(original,values);assert.equal(industrialLighting.profile(original,false),original);
}

// Exercise the public viewer's same proxy and target lifecycle without a world
// capture. An existing native environment remains foreign and is never owned.
const publicSource=fs.readFileSync(path.resolve(__dirname,'../../apps/public-viewer/IndustrialEnvironment.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function createIndustrialEnvironment','return function createIndustrialEnvironment');
let builds=0,disposals=0,generatorDisposals=0;
const MockThree=Object.assign({},THREE,{PMREMGenerator:class {fromScene(proxy){builds++;assert.equal(proxy.children.length,9);assert.notEqual(proxy,scene);assert.equal(publicRenderer.xr.enabled,false);return {texture:new THREE.Texture(),dispose(){disposals++;}};}dispose(){generatorDisposals++;}}});
const createPublic=new Function('THREE','industrialLighting','industrialSurfaces',publicSource)(MockThree,industrialLighting,industrialSurfaces),publicScene=new THREE.Scene(),publicRoof=new THREE.Mesh(new THREE.BoxBufferGeometry(),new THREE.MeshStandardMaterial());publicRoof.name='RV · cubierta';publicScene.add(publicRoof);
const listeners=new Map(),viewport=new THREE.Vector4(2,3,640,480),scissor=new THREE.Vector4(4,5,620,460),foreign={name:'foreign-framebuffer'};let target=foreign;
const publicRenderer={toneMappingExposure:1,capabilities:{},getContext(){},shadowMap:{enabled:false},xr:{enabled:true},
 domElement:{addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}},
 getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},getViewport:out=>out.copy(viewport),setViewport:value=>assert(value.equals(viewport)),getScissor:out=>out.copy(scissor),setScissor:value=>assert(value.equals(scissor)),getScissorTest:()=>true,setScissorTest:value=>assert.equal(value,true)};
const publicConfig={roomId:'hall',sunIntensity:.6,ambientIntensity:.25,exposure:.87,shadows:true},publicDocument={roomId:'hall',studio:{environments:[publicConfig],entities:[]},additions:new Map([['roof',{roomId:'hall',object:publicRoof,descriptor:{type:'box'}}]]),getBehaviors:()=>[]};
const ctx={renderer:publicRenderer,performanceRenderTargets:new Set()},lighting=createPublic(publicScene,publicDocument,ctx),initialTexture=publicScene.environment;
assert.equal(lighting.stats.profile,'industrial-neutral');assert.equal(lighting.stats.reflectionBuilds,1);assert(initialTexture);assert.equal(ctx.performanceRenderTargets.size,1);assert.equal(target,foreign);assert.equal(publicRenderer.xr.enabled,true);
for(let i=0;i<60;i++)lighting.sync();assert.equal(builds,1);assert.equal(publicScene.environment,initialTexture);assert.equal(ctx.performanceRenderTargets.size,1);
listeners.get('webglcontextlost')();assert.equal(disposals,1);assert.equal(ctx.performanceRenderTargets.size,0);assert.equal(publicScene.environment,null);lighting.sync();assert.equal(builds,1);
listeners.get('webglcontextrestored')();assert.equal(builds,1,'No GPU allocation is attempted inside the context event.');lighting.sync();assert.equal(builds,2);assert.notEqual(publicScene.environment,initialTexture);assert.equal(ctx.performanceRenderTargets.size,1);
lighting.dispose();assert.equal(disposals,2);assert.equal(generatorDisposals,2);assert.equal(ctx.performanceRenderTargets.size,0);assert.equal(listeners.size,0);assert.equal(publicScene.environment,null);
const nativeTexture=new THREE.Texture();publicScene.environment=nativeTexture;const native=createPublic(publicScene,publicDocument,ctx);assert.equal(builds,2);native.dispose();assert.equal(publicScene.environment,nativeTexture);nativeTexture.dispose();publicRoof.geometry.dispose();publicRoof.material.dispose();
// Keep the native/reference room's earlier IBL recipe exactly as it was. An
// industrial room uses another cache key and replaces, rather than retaining,
// the previous target when the presentation profile changes.
for(const indoor of [false,true]){
 const proxy=industrialLighting.reflectionRoom(THREE,indoor),colors=proxy.scene.children.map(mesh=>mesh.material.color);
 const linear=(value,power=1)=>new THREE.Color(value).convertSRGBToLinear().multiplyScalar(power);
 assert(colors[0].equals(linear(indoor?'#596369':'#414743')));assert(colors[1].equals(linear(indoor?'#3f4b52':'#272d29')));
 assert(colors[2].equals(linear(indoor?'#f3f7fa':'#fff4e2',indoor?1.8:1.6)));assert(colors[8].equals(linear(indoor?'#a1aeb8':'#9aa8b0',indoor?1:.85)));proxy.dispose();
}
let cachedBuilds=0,cachedDisposals=0;
const CacheThree=Object.assign({},THREE,{PMREMGenerator:class {fromScene(){cachedBuilds++;return {texture:new THREE.Texture(),dispose(){cachedDisposals++;}};}dispose(){}}});
const CachedEnvironment=new Function('THREE','schema','industrialLighting','industrialSurfaces',source)(CacheThree,schema,industrialLighting,industrialSurfaces),cache=new CachedEnvironment({});
const legacyIBL=cache.createReflections(publicRenderer,false);assert.equal(cache.createReflections(publicRenderer,false),legacyIBL);assert.equal(cachedBuilds,1);
const industrialIBL=cache.createReflections(publicRenderer,true);assert.notEqual(industrialIBL,legacyIBL);assert.equal(cachedBuilds,2);assert.equal(cachedDisposals,1);
assert.equal(cache.createReflections(publicRenderer,true),industrialIBL);assert.equal(cachedBuilds,2);
assert.notEqual(cache.createReflections(publicRenderer,false),industrialIBL);assert.equal(cachedBuilds,3);assert.equal(cachedDisposals,2);cache.dispose();assert.equal(cachedDisposals,3);
console.log('Industrial lighting: neutral legacy profile, unchanged custom/native scenes, one hemispheric bounce, one shadow map, shared cached public IBL, context recovery and complete ownership cleanup passed.');
