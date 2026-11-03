import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const catalog=require('../../modules/logistica-industrial/contracts/resourceCatalog.js');
const equipment=require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs');
const knowledge=require('../../modules/logistica-industrial/documentation/index.cjs');
const taxonomy=catalog.libraryTaxonomy,families=catalog.resourceFamilies;
const resources=taxonomy.decorate(catalog.RESOURCES),byId=new Map(resources.map(resource=>[resource.id,resource]));
const native=id=>byId.get('library:'+id),generated=id=>byId.get('catalogue:equipment.'+id);
const location=resource=>{assert(resource);const {group,subgroup}=taxonomy.location(resource);return[group,subgroup];};
const family=resource=>{assert(resource);const result=families.familyFor(resource);assert(result,resource.id);return result.id;};

test('every registered equipment and every source article has a valid specific library path',()=>{
 assert.equal(catalog.LEGACY_RESOURCES.length,108);
 assert.equal(resources.length,108+equipment.DEFINITIONS.length);
 assert.equal(byId.size,resources.length,'No identity is lost to family presentation.');
 for(const resource of resources){
  const paths=taxonomy.memberships(resource);assert(paths.length,resource.id);
  for(const path of paths){const group=taxonomy.GROUPS.find(group=>group.id===path.group);assert(group,resource.id);assert(group.children.some(child=>child[0]===path.subgroup),resource.id+' / '+JSON.stringify(path));}
  if(resource.catalogueEquipmentId){const path=taxonomy.cataloguePath(resource);assert(path,resource.catalogueEquipmentId+' needs an explicit mechanism classification');assert.equal(resource.catalogueGroup,path.group);assert.equal(resource.catalogueSubgroup,path.subgroup);}
 }
 for(const definition of equipment.DEFINITIONS)assert(taxonomy.cataloguePath({catalogueEquipmentId:definition.id}),definition.id);
 const concepts=taxonomy.pendingResources([]);assert.equal(concepts.length,knowledge.entries.length);
 for(const concept of concepts){assert.equal(concept.action,null);assert.equal(concept.model,null);assert.equal(families.familyFor(concept),null);const path=taxonomy.memberships(concept)[0],group=taxonomy.GROUPS.find(group=>group.id===path.group);assert(group.children.some(child=>child[0]===path.subgroup),concept.id);}
 assert(!taxonomy.SUBGROUPS.TR.some(row=>row[0]==='specialized'));
 assert(!taxonomy.SUBGROUPS.VE.some(row=>row[0]==='other'));
 assert(!taxonomy.SUBGROUPS.RO.some(row=>row[0]==='other'));
 assert(!taxonomy.SUBGROUPS.AL.some(row=>row[0]==='automated'));
});

test('advanced mechanisms are placed by their real operation rather than their generic rendering fallback',()=>{
 for(const [id,expected] of Object.entries({
  'transport.flat-belt':['TR','straight'],'transport.curve':['TR','curved'],
  'transport.overhead':['TR','overhead'],'transport.spiral':['TR','spiral'],
  'transport.vibratory':['TR','vibratory'],'transport.screw':['TR','screw'],
  'transport.bucket-elevator':['TR','bucket'],'transport.pneumatic':['TR','pneumatic'],
  'transport.telescopic':['TR','loading'],'transport.stops-guides':['TR','guides'],
  'vehicle.freight-truck':['VE','freight'],'mobile.inventory-drone':['VE','inventory'],
  'vehicle.ergonomic-manipulator':['VE','manipulators'],'vehicle.overhead-crane':['VE','lifting'],
  'storage.cantilever':['AL','cantilever'],'storage.drive-in':['AL','compact'],
  'storage.carton-flow':['AL','carton-flow'],'storage.vertical-lift':['AL','vertical-lift'],
  'storage.pallet-asrs':['AL','pallet-asrs'],'storage.cube':['AL','cube'],
  'storage.carousel':['AL','carousel'],'storage.multilevel-shuttle':['AL','shuttle'],
  'sensor.barcode-rf':['MU','identification'],'sensor.platform-scale':['MU','weighing'],
  'sensor.checkweigher':['EM','packing'],'picking.receiving-inspection':['MU','receiving'],
  'picking.packing-bench':['EM','packing'],'picking.decanting':['PI','decanting'],
  'control.charging-station':['SE','energy'],'control.wcs':['SI','execution'],'utility.extraction':['MA','services']
 }))assert.deepEqual(location(generated(id)),expected,id);
 assert.deepEqual(location(native('conveyor.curve')),['TR','curved']);
 assert.deepEqual(location(native('conveyor.belt')),['TR','straight']);
 assert.deepEqual(location(native('vehicle.cylindrical')),['RO','cylindrical']);
 assert.deepEqual(location(native('vehicle.polar')),['RO','polar']);
 for(const id of ['vehicle.mobile','robot.agv','robot.shuttle','vehicle.sorter'])assert.deepEqual(location(native(id)),['VE','automated'],id);
 assert.deepEqual(location(native('vehicle.mobile-manipulator')),['RO','mobile']);
});

test('related documentation remains searchable without scattering a robot or rack into unrelated folders',()=>{
 const robot=native('vehicle.industrial'),rack=native('storage.rack');
 assert(robot.documentationLinks.some(link=>link.relation==='family'),'Exercise real related-document metadata.');
 const related=robot.documentationLinks.find(link=>link.relation==='family');
 assert(catalog.matches(robot,related.articleId),'Related concepts still participate in search.');
 assert(!taxonomy.matchesPath(robot,'group:SE'),'A robot is not a sensor merely because its article references one.');
 assert(!taxonomy.matchesPath(robot,'group:SI'),'Control-system references do not make a robot an enterprise system.');
 assert(!taxonomy.matchesPath(rack,'group:SI'),'Rack information remains attached to the storage mechanism.');
 const linked={...robot,documentationLinks:[{articleId:'SE-01',relation:'family'}]};
 assert.deepEqual(taxonomy.memberships(linked),[{group:'RO',subgroup:'articulated'}]);
 const exact={...linked,documentationLinks:[{articleId:'SE-01',relation:'exact'}]};
 assert(taxonomy.matchesPath(exact,'group:SE/sensing'),'An intentional exact native capability retains secondary discovery.');
 for(const [old,current]of [['group:TR/specialized','group:TR'],['group:VE/other','group:VE'],['group:RO/other','group:RO'],['group:AL/automated','group:AL']]){
  assert.equal(taxonomy.normalizedPath(old),current);assert.equal(taxonomy.title(old),taxonomy.title(current));
  assert.deepEqual(resources.filter(r=>taxonomy.matchesPath(r,old)).map(r=>r.id),resources.filter(r=>taxonomy.matchesPath(r,current)).map(r=>r.id));
 }
});

test('all files and authored scene resources remain independent and discoverable',()=>{
 const raw=require('../../packages/tools/editor/assets/catalog.json');assert.equal(raw.length,188);
 const kindOf=path=>/\.(glb|gltf|obj|fbx)$/i.test(path)?'model':/\.(png|jpe?g|webp|svg|gif)$/i.test(path)?'image':/\.(wav|mp3|ogg)$/i.test(path)?'audio':/\.(mp4|webm)$/i.test(path)?'video':/\.blend$/i.test(path)?'source':/\.(json|txt|csv|js)$/i.test(path)?'text':'other';
 for(const entry of raw){const asset=catalog.assetResource({...entry,kind:kindOf(entry.path)});assert.deepEqual(location(asset),['FILES',kindOf(entry.path)]);assert.equal(families.familyFor(asset),null);}
 const authored=catalog.projectResources([{id:'t',name:'Template',objects:[]}],[{id:'s',name:'Scene'}],[{id:'w',name:'Widget',kind:'counter',roomId:'s'}],[{id:'m',name:'Mission',roomId:'s'}]);
 for(const [i,subgroup]of ['template','scene','interface','education'].entries()){assert.deepEqual(location(authored[i]),['COMMON',subgroup]);assert.equal(families.familyFor(authored[i]),null);}
 assert.deepEqual(location({id:'extension:local',origin:'project',category:'custom',action:null}),['COMMON','extension']);
});

test('family cards preserve every original variant, ID, action and favorite resolution',()=>{
 const before=JSON.stringify(resources),grouped=families.listFamilies(resources),flat=grouped.flatMap(row=>row.variants),ungrouped=resources.filter(resource=>!families.familyFor(resource));
 assert.equal(new Set(grouped.map(row=>row.id)).size,grouped.length);
 assert.deepEqual(new Set(flat.concat(ungrouped).map(resource=>resource.id)),new Set(resources.map(resource=>resource.id)));
 assert.equal(flat.length+ungrouped.length,resources.length);
 assert(grouped.length+ungrouped.length<resources.length-50,'Compaction must remove redundant cards rather than simply rename them.');
 for(const row of grouped){
  assert.equal(row.count,row.variants.length);assert.deepEqual(row.variantIds,row.variants.map(r=>r.id));assert(row.variantIds.includes(row.representativeId));
  assert.deepEqual(families.listVariants(row.id,resources),row.variants);assert.deepEqual(families.listVariants(row),row.variants);
  for(const resource of row.variants){assert.equal(resource,byId.get(resource.id));assert.equal(families.resolve(resource.id,resources),resource);assert.equal(family(resource),row.id);}
  assert(row.variants.includes(families.resolve(row.id,resources)));
 }
 for(const resource of ungrouped)assert.equal(families.resolve(resource.id,resources),resource);
 assert.equal(families.resolve('family:does-not-exist',resources),null);
 assert.equal(families.familyFor('library:vehicle.forklift',resources).id,family(native('vehicle.forklift')));
 assert.equal(families.familyFor('library:does-not-exist',resources),null);
 assert.equal(JSON.stringify(resources),before,'Listing and resolving families cannot change actions, defaults, documents or identity.');
});

test('search and filtered family selections only choose variants in the supplied result set',()=>{
 const id=family(native('vehicle.forklift')),choice=native('vehicle.forklift-ic');
 const selected=families.listFamilies(resources,{selectedId:choice.id}).find(row=>row.id===id);assert.equal(selected.representativeId,choice.id);
 const onlyMatch=families.listFamilies([choice]);assert.equal(onlyMatch.length,1);assert.equal(onlyMatch[0].representativeId,choice.id);assert.deepEqual(onlyMatch[0].variants,[choice]);
 const reordered=families.listFamilies([...resources].reverse()).find(row=>row.id===id);assert.equal(reordered.representativeId,'library:vehicle.forklift');
 const unrelated=families.listFamilies(resources,{selectedId:native('product.box').id}).find(row=>row.id===id);assert.equal(unrelated.representativeId,'library:vehicle.forklift','An unrelated selection must not erase the preferred family representative.');
 assert(families.listFamilies(resources,{minVariants:2}).every(row=>row.count>=2));
});

test('incompatible mechanisms never merge merely because their fallback prefab is similar',()=>{
 const distinct=ids=>{const result=ids.map(([origin,id])=>family(origin==='native'?native(id):generated(id)));assert.equal(new Set(result).size,result.length,JSON.stringify(ids));};
 distinct(['storage.selective','storage.double-deep','storage.drive-in','storage.drive-through','storage.push-back','storage.pallet-flow','storage.carton-flow','storage.miniload','storage.pallet-asrs','storage.vertical-lift'].map(id=>['generated',id]));
 distinct([['native','conveyor.curve'],['native','conveyor.belt-curve'],['native','conveyor.modular-curve']]);
 distinct(['transport.bucket-elevator','transport.vertical-lift','transport.spiral'].map(id=>['generated',id]));
 distinct(['vehicle.counterbalance','vehicle.reach-truck','vehicle.stacker','vehicle.vna'].map(id=>['generated',id]));
 distinct(['robot.articulated','robot.scara','robot.four-axis-palletizer','robot.delta','robot.cartesian'].map(id=>['generated',id]));
 distinct([['native','product.cage'],['generated','product.roll-container']]);
 distinct(['product.discrete-part','product.long-stock','product.metal-part'].map(id=>['generated',id]));
 distinct(['product.drum','product.hazardous'].map(id=>['generated',id]));
 distinct(['tool.arc-welder','tool.mig-welder','tool.tig-welder','tool.spot-welder'].map(id=>['generated',id]));
 assert.equal(family(native('vehicle.forklift')),family(generated('vehicle.counterbalance')));
 assert.equal(family(native('conveyor.curve')),family(generated('transport.curve')));
 assert.equal(family(native('rack.light-duty')),family(generated('storage.light-medium')));
 assert.equal(family(native('product.pallet-euro')),family(generated('product.wood-pallet')));
});

test('configuration metadata reuses the actual schema and cloned presets without inventing editable fields',()=>{
 const resource=native('conveyor.curve'),before=JSON.stringify(resource),config=families.configuration(resource);
 assert.equal(config.kind,resource.action.kind);assert.equal(config.variant,resource.action.variant);assert.equal(config.requiresNativeValidation,true);
 assert(config.fields.some(field=>field.key==='radius'));assert.deepEqual(config.fields,resource.definition.parameters.filter(field=>field&&typeof field==='object'&&typeof field.key==='string'));
 assert.deepEqual(config.preset,{...resource.definition.preset,...resource.action.config});config.fields[0].label='Changed';config.preset.length=999;
 assert.equal(JSON.stringify(resource),before);
 const custom={id:'library:test',action:{type:'prefab',kind:'conveyor',variant:'belt',config:{nested:{value:1}}},definition:{parameters:[{key:'choice',options:[{value:'a'}]}],preset:{length:2}}};
 const editable=families.configuration(custom);editable.fields[0].options[0].value='b';editable.preset.nested.value=2;assert.equal(custom.definition.parameters[0].options[0].value,'a');assert.equal(custom.action.config.nested.value,1);
 assert.deepEqual(families.configuration(generated('storage.selective')).fields,[],'No schema labels may become unvalidated fields.');
 assert.equal(families.configuration(native('education.mission')),null);assert.equal(families.configuration(null),null);
});

test('taxonomy and family browsing do not load full wiki contents, images or rendering runtimes',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const probe="const c=require('./modules/logistica-industrial/contracts/resourceCatalog');c.resourceFamilies.listFamilies(c.RESOURCES);console.log(JSON.stringify(Object.keys(require.cache).filter(name=>/documentation[\\\\/](?:catalog\\.cjs|assets)|render-three[\\\\/]|[\\\\/]runtime[\\\\/]/.test(name))))";
 const result=spawnSync(process.execPath,['-e',probe],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),[]);
});

test('unrecognized imported metadata cannot inherit a family or break saved folder navigation',()=>{
 for(const name of ['__proto__','constructor','toString']){
  assert.equal(taxonomy.normalizedPath(name),name);assert.equal(taxonomy.matchesPath(native('conveyor.curve'),name),false);
  assert.equal(families.familyFor({id:'library:external',action:{type:'prefab',kind:name,variant:'constructor'}}),null);
  assert.equal(families.familyFor({id:'library:external',action:{type:'prefab',kind:'conveyor',variant:name}}),null);
  assert.deepEqual(location({id:'extension:test',category:name}),['COMMON','extension']);
  assert.deepEqual(location({id:'asset:test',asset:{kind:name}}),['FILES','other']);
 }
});
