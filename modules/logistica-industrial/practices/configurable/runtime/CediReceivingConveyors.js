import ConveyorAssembly from '../../../functions/bandas/runtime/ConveyorAssembly.js';
import receivingLayout from '../CediReceivingLayout.cjs';

// Factory microfinishes are byte-identical DataTextures, but a fresh texture
// UUID on every bolt prevents the existing reversible render banks from
// sharing an otherwise exact material draw. Pool those immutable pixels only
// INSIDE one actor. Materials remain private; separately editable equipment,
// moving roller maps, displays and canvas/video textures never share owners.
function poolMicrofinishes(actor){
 const groups=new Map(),seen=new Set(),retired=new Set(),before=new Set();let reused=0;
 const properties=texture=>JSON.stringify(['format','type','mapping','wrapS','wrapT','magFilter','minFilter','anisotropy','encoding','flipY','premultiplyAlpha','unpackAlignment','generateMipmaps','matrixAutoUpdate','rotation'].map(key=>texture[key]).concat([texture.offset.toArray(),texture.repeat.toArray(),texture.center.toArray(),texture.matrix.elements]));
 const pixels=texture=>new Uint8Array(texture.image.data.buffer,texture.image.data.byteOffset,texture.image.data.byteLength);
 const equal=(a,b)=>{const x=pixels(a),y=pixels(b);return x.length===y.length&&x.every((value,index)=>value===y[index]);};
 actor.traverse(node=>{
  for(let parent=node;parent&&parent!==actor;parent=parent.parent){const d=parent.userData||{};if(d.industrialRoller||d.industrialBelt||d.industrialDisplay)return;}
  for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[]){
   // Shared factory materials may be visited by more than one mesh; do not
   // count a map/bumpMap alias as a distinct allocation.
   if(seen.has(material))continue;seen.add(material);
   for(const key of Object.keys(material)){
    const texture=material[key];
    if(!texture||!texture.isDataTexture||!/^Microacabado fabricado \/ /.test(texture.name)||!texture.image||!ArrayBuffer.isView(texture.image.data)||texture.mipmaps.length||texture.onUpdate)continue;
    before.add(texture);const bytes=pixels(texture);let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619);
    const signature=[texture.image.width,texture.image.height,bytes.length,hash>>>0,properties(texture)].join('|'),bucket=groups.get(signature)||[],canonical=bucket.find(candidate=>equal(candidate,texture));
    if(canonical&&canonical!==texture){material[key]=canonical;retired.add(texture);reused++;}
    else if(!canonical){bucket.push(texture);groups.set(signature,bucket);}
   }
  }
 });
 // Dispose a retired allocation only after every material reference in this
 // owning actor has been scanned, including invisible original/study meshes.
 // Other actors never receive one of this actor's canonical textures.
 actor.traverse(node=>{for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[])for(const value of Object.values(material))if(value&&value.isTexture)retired.delete(value);});
 retired.forEach(texture=>texture.dispose());
 return{privateActor:true,originalTextures:before.size,retainedTextures:before.size-retired.size,reusedSlots:reused,disposedDuplicates:retired.size};
}

// Actual receiving conveyors, using the editor's native factories, custody and
// port-validation service. No sources, phantom pallets or additional renderer.
export function buildReceivingConveyors(doc,roomId,plan,objects=[]){
 if(plan.id!=='CEDI-01')return null;
 const layout=receivingLayout.layout(),nativeIds={},actors=new Map(),texturePools=[];
 for(const[key,zone,kind,equipment,pose,active,values]of layout.fixtures){
  if(kind!=='conveyor')continue;
  const object=doc.addPrefab(roomId,kind,'catalogue:'+equipment),before=doc.getBehaviors(object).find(row=>row.type==='conveyor');
  if(!before)throw Error('La línea de recepción necesita un transportador nativo.');
  doc.setBehaviors(object,doc.getBehaviors(object).map(row=>row.type==='conveyor'?Object.assign({},row,values,{outputId:'',branchId:'',autoSpawn:false,withPallet:false}):row));
  doc.setTransform(object,{position:pose.slice(0,3),rotation:[0,pose[3]||0,0]});
  doc.setProperty(object,'name',key.indexOf('intake')>=0?'Recepción · rodillos de entrada '+(Number(key.split('-').pop())+1):key.indexOf('transfer')>=0?'Recepción · transferencia a 90° '+(Number(key.split('-').pop())+1):key==='receiving-outfeed'?'Recepción · salida de inspección':'Recepción · colector de rodillos '+(Number(key.split('-').pop())+1));
  object.userData.cediReceiving={layoutId:layout.id,key,zone,interactive:true};
  object.userData.cediOperation={practiceId:plan.id,active:true,layoutId:layout.id};
  object.traverse(child=>{const defaults=child.userData.editorDefaultBehaviors;if(Array.isArray(defaults)&&defaults.some(row=>Object.values(row).includes('@root')))child.userData.editorDefaultBehaviors=JSON.parse(JSON.stringify(defaults,(key,value)=>value==='@root'?object.userData.editorId:value));});
  texturePools.push(Object.assign({key},poolMicrofinishes(object)));
  objects.push(object);actors.set(key,object);nativeIds[key]=object.userData.editorId;
 }
 const assembly=new ConveyorAssembly({document:doc,roomId}),links=[];
 for(const link of layout.connections){
  const source=actors.get(link.sourceKey),target=actors.get(link.targetKey),assessment=assembly.assessConnection(source,link.sourcePort,target,link.targetPort);
  if(!assessment.ready||assessment.gap>1e-6||assessment.heading<.999999)throw Error('Conexión física de recepción incompatible: '+link.sourceKey+' → '+link.targetKey);
  const pair=assembly.pair(source,link.sourcePort,target,link.targetPort);
  if(!pair||!assembly.connect(pair))throw Error('No se pudo enlazar la línea nativa de recepción.');
  links.push(Object.assign({},link,{sourceId:nativeIds[link.sourceKey],targetId:nativeIds[link.targetKey],gap:assessment.gap,heading:assessment.heading,ready:true}));
 }
 return{version:layout.version,layoutId:layout.id,nativeIds,conveyorIds:Object.values(nativeIds),links,deckY:layout.deckY,texturePools,
  inlets:layout.inlets.map(inlet=>Object.assign({},inlet,{objectId:nativeIds[inlet.key]})),outlet:Object.assign({},layout.outlet,{objectId:nativeIds[layout.outlet.key]}),
  generatedProductCount:0,policy:layout.policy};
}
