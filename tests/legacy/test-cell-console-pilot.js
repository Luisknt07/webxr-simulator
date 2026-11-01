'use strict';
// Actual generated native meshes, real ray hits and pinned historical poses.
const assert=require('node:assert/strict'),fs=require('node:fs'),THREE=require('three');
const behaviorSchema=require('../../modules/logistica-industrial/contracts/behaviors');
const robots=require('../support/load-robot-prefabs')(THREE),history=require('../fixtures/cell-console-baseline-0ceb.json');
const read=p=>fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const native=new Function('THREE','behaviorSchema','require',read('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js')+'\nreturn createIndustrialPrefab;')(THREE,behaviorSchema,robots.resolve);
let allocations=0;function factory(...args){allocations++;return native(...args);}factory.refresh=native.refresh;factory.enforceOptions=native.enforceOptions;
const SceneDocument=new Function('THREE','behaviorSchema','createIndustrialPrefab',read('packages/project-model/src/SceneDocument.js').replace('default class SceneDocument','return class SceneDocument'))(THREE,behaviorSchema,factory);
const visible=n=>{for(let p=n;p;p=p.parent)if(!p.visible)return false;return true;},clone=x=>JSON.parse(JSON.stringify(x));
const near=(a,b,label='value')=>{if(typeof b==='number')return assert(Math.abs(a-b)<1e-10,label+': '+a+' != '+b);if(!b||typeof b!=='object')return assert.equal(a,b,label);assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),label);for(const key of Object.keys(b))near(a[key],b[key],label+'.'+key);};
function splitBoxes(node){
 const g=node.geometry,p=g.attributes.position,index=g.index,ids=new Map(),parents=[],vertices=[];
 const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parents[b]=a;};
 for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i),key=v.toArray().map(n=>Math.round(n*1e6)).join(':');parents[i]=i;vertices.push(v);if(ids.has(key))union(i,ids.get(key));else ids.set(key,i);}
 const count=index?index.count:p.count;for(let i=0;i<count;i+=3){const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);union(ids[0],ids[1]);union(ids[1],ids[2]);}
 const groups=new Map();for(let i=0;i<p.count;i++){const id=find(i);if(!groups.has(id))groups.set(id,new THREE.Box3());groups.get(id).expandByPoint(vertices[i]);}
 return [...groups.values()].map(box=>({node,box,center:box.getCenter(new THREE.Vector3()).applyMatrix4(node.matrixWorld)}));
}
let probes=0;
function inspectGeometry(){
 for(const yaw of [0,Math.PI/2,Math.PI,-.4]){
  const root=factory('robot','articulated-general'),panel=root.children[1];root.position.set(2,0,-3);root.rotation.y=yaw;root.updateWorldMatrix(true,true);
  assert.equal(panel.userData.industrialPanelDesign,'cell-console');const assembly=panel.children.find(n=>n.userData.industrialCellConsole);assert(assembly&&visible(assembly));
  assert.equal(panel.children[0].visible,false);assert.equal(panel.children.find(n=>n.name==='Armario y pedestal').visible,false,'Old shell must not overlap the new cabinet');
  const commands=panel.children.filter(n=>n.userData.editorPrefabKey==='control');assert.deepEqual(commands.map(n=>n.userData.industrialAction),history.controls.map(n=>n.action));
  const inverse=new THREE.Matrix4().getInverse(panel.matrixWorld),bounds=new THREE.Box3();assembly.traverse(n=>{if(!n.geometry)return;const g=n.geometry,p=g.attributes.position;for(const a of Object.values(g.attributes)){assert.equal(a.count,p.count);assert([...a.array].every(Number.isFinite));}g.computeBoundingBox();bounds.union(g.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,n.matrixWorld)));});assert(Math.abs(bounds.min.y+1.28)<1e-6,'Floor-console base stays on its original floor plane');
  const tower=panel.children.find(n=>n.name==='Torre luminosa');assert(tower.visible);assert(tower.position.z<-.30,'Beacon stays on the REAR deck, behind the HMI/keypad');assert(Math.abs(tower.position.y-bounds.max.y)<1e-6,'Beacon stem starts exactly on the horizontal roof');
  const stem=tower.children[0],stemPoint=stem.localToWorld(new THREE.Vector3(0,-.085,0)),deckRay=new THREE.Raycaster(stemPoint.clone().add(new THREE.Vector3(0,.025,0)),new THREE.Vector3(0,-1,0),0,.06),deckHit=deckRay.intersectObject(assembly,true).filter(hit=>visible(hit.object))[0];assert(deckHit&&Math.abs(deckHit.point.y-stemPoint.y)<1e-6,'The beacon has a real supporting cabinet face');probes++;
  const screen=panel.children[1],keyboard=[];assembly.traverse(n=>{if(n.geometry&&/Tecla HMI/.test(n.material.name))keyboard.push(...splitBoxes(n));});assert.equal(keyboard.length,12,'All twelve separate HMI keys are real visible geometry');
  for(const side of [-.55,0,.55]){
   const eye=panel.localToWorld(new THREE.Vector3(side,.32,1.2));
   const hitTarget=(node,target,label)=>{const hits=new THREE.Raycaster(eye,target.clone().sub(eye).normalize(),0,3).intersectObject(panel,true).filter(hit=>visible(hit.object));assert(hits.length&&hits[0].object===node,label+' from side '+side+' is occluded by '+(hits[0]&&hits[0].object.material.name)+' gap '+(hits[0]&&eye.distanceTo(target)-hits[0].distance));probes++;};
   for(const command of commands){
    const cap=command.children.find(n=>n.userData.industrialButton),caption=command.children.find(n=>n.name==='Rótulo del control');assert(cap&&caption);
    const position=command.getWorldPosition(new THREE.Vector3());assert(position.y>1.1&&position.y<1.5,'Buttons stay at standing reach height');
    hitTarget(cap,cap.getWorldPosition(new THREE.Vector3()),command.userData.industrialAction+' cap');hitTarget(caption,caption.localToWorld(new THREE.Vector3(.001,.001,0)),command.userData.industrialAction+' caption');
   }
   screen.geometry.computeBoundingBox();const box=screen.geometry.boundingBox;for(const [u,v]of [[0,0],[-.95,-.95],[-.95,.95],[.95,-.95],[.95,.95]]){const point=new THREE.Vector3(box.max.x*u,box.max.y*v,box.max.z).applyMatrix4(screen.matrixWorld);hitTarget(screen,point,'HMI centre/corner');}
   for(const key of keyboard)hitTarget(key.node,key.center,'Keypad key');
  }
  // All command actors retain independent press meshes and space between them.
  commands.forEach((node,index)=>{assert(node.children[1].userData.industrialButton);commands.slice(index+1).forEach(other=>assert(node.position.distanceTo(other.position)>.17,'No adjacent pushbuttons overlap'));});
 }
}
const setup=()=>{const d=new SceneDocument({});for(const room of ['hall','sound'])d.registerRoom(room,new THREE.Group());return d;};
const record=(data,id)=>Object.values(data.rooms).flatMap(room=>room.additions).find(row=>row.id===id);
async function inspectMigration(){
 assert.equal(history.revision,'0ceb123749de1faaee3b992fd4417d6a0d69191c');assert.equal(history.controls.length,9);
 const doc=setup(),objects=[doc.addPrefab('hall','robot','articulated-general'),doc.addPrefab('sound','robot','articulated-general')];
 const first=objects[0],entry=doc.additions.get(first.userData.editorId),marked=entry.nodes.get('1.9');
 doc.setTransform(entry.nodes.get('1'),{position:[-.93,1.31,-1.42],rotation:[.02,-.26,.01],scale:[.94,1.03,.96]});
 doc.setBehaviors(marked,doc.getBehaviors(marked).concat([{...behaviorSchema.defaultBehavior('surfaceMaterial'),color:'#a94822',wear:.62}]));await doc.replaceAsset(marked,{type:'cylinder',color:'#25c8a9'});
 const expected=await doc.serialize(),old=clone(expected);
 for(const object of objects)for(const pose of history.controls){const state=record(old,object.userData.editorId).nodes[pose.path];for(const field of ['position','quaternion','scale'])state[field]=pose[field].slice();}
 const row=record(old,first.userData.editorId),target=record(expected,first.userData.editorId);row.nodes['1.2'].position=[-.61,.32,.25];row.nodes['1.3'].quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(.06,.18,-.02)).toArray();row.nodes['1.4'].scale=[.91,1.03,.87];for(const path of ['1.2','1.3','1.4'])target.nodes[path]=clone(row.nodes[path]);row.nodes['1.7'].quaternion=row.nodes['1.7'].quaternion.map(n=>n===0?0:-n);
 const untouched=clone(old),validator=setup(),calls=allocations;near(validator._validate(old).rooms,expected.rooms,'0ceb automatic console migration');assert.equal(allocations,calls,'Saved-room migration is pure data, without model allocation');assert.deepEqual(old,untouched);
 const loaded=setup();await loaded.load(old,{activeRoomId:'hall'});assert(loaded.hasPendingRoom('sound'));near((await loaded.serialize()).rooms,expected.rooms,'Lazy-room console poses');await loaded.activateRoom('sound');near((await loaded.serialize()).rooms,expected.rooms,'Hydrated console poses');
 for(const object of objects){const entry=loaded.additions.get(object.userData.editorId);assert.equal(entry.nodes.get('1').userData.industrialPanelDesign,'cell-console');for(const pose of history.controls)assert.equal(loaded.getBehaviors(entry.nodes.get(pose.path)).find(b=>b.type==='control').targetId,object.userData.editorId);}
 const saved=await loaded.serialize();require('../../apps/api/server/validation').validateDocument(saved,x=>x);const reopened=setup();await reopened.load(saved);near(await reopened.serialize(),saved,'Saved console idempotence');
 const snapshot=doc.captureObject(first);snapshot.record=clone(row);const preserved=clone(snapshot),copy=await loaded.pasteObject(snapshot,'hall',3),copied=loaded.additions.get(copy.userData.editorId);assert.deepEqual(snapshot,preserved);for(const pose of history.controls){near(copied.nodes.get(pose.path).position.toArray(),target.nodes[pose.path].position,'Copied current console pose');assert.equal(loaded.getBehaviors(copied.nodes.get(pose.path)).find(b=>b.type==='control').targetId,copy.userData.editorId);}const after=await loaded.serialize();assert(loaded.undo());assert(loaded.redo());near(await loaded.serialize(),after,'Console paste undo/redo');
 const single=clone(saved),singleRow=record(single,objects[1].userData.editorId),pose=history.controls[0];for(const key of ['position','quaternion','scale'])singleRow.nodes[pose.path][key]=pose[key].slice();near(setup()._validate(single).rooms,single.rooms,'One old-looking author control is preserved');
}
inspectGeometry();inspectMigration().then(()=>console.log('Cell-console pilot: '+probes+' native ray probes across four world headings, nine usable caps/captions, HMI corners and twelve keypad keys, real floor/deck beacon support, no duplicate shell, exact captured0ceb migration, authored TRS/material/asset preservation, lazy load, clipboard bindings and idempotent undo/reopen passed.')).catch(error=>{console.error(error);process.exitCode=1;});
