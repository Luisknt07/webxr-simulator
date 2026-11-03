'use strict';

// A presentation family is a set of explicitly related catalogue entries. It
// never becomes a prefab, saved resource, replacement model or mutable machine.
// Variants below always retain their own original IDs, actions and definitions.
const taxonomy=require('./libraryTaxonomy.js');
const equipment=require('../functions/equipamiento/schema/equipmentCatalog.cjs');
const NATIVE={
 conveyor:{'roller-motor':'transport.roller-box',belt:'transport.flat-belt','roller-gravity':'transport.roller-gravity','pallet-chain':'transport.pallet-chain','roller-curve':'transport.curve','belt-curve':'transport.belt-curve','modular-curve':'transport.modular-curve','belt-incline':'transport.belt-incline','cleated-incline':'transport.belt-incline','modular-incline':'transport.modular-incline','popup-belt':'transport.popup-transfer','popup-chain':'transport.popup-transfer','roller-turntable':'transport.turntable','pallet-turntable':'transport.turntable',pusher:'transport.pusher',steer:'transport.steer','merge-angle':'transport.merge',distributor:'transport.junction','roller-zones':'transport.zero-pressure','belt-zones':'transport.belt-zones','box-elevator':'transport.vertical-lift','pallet-elevator':'transport.vertical-lift','loading-table':'transport.loading-table','manual-station':'transport.manual-station','automatic-station':'transport.automatic-station'},
 vehicle:{'forklift-electric-3w':'vehicle.counterbalance','forklift-electric-4w':'vehicle.counterbalance','forklift-ic':'vehicle.counterbalance','reach-truck':'vehicle.reach-truck',stacker:'vehicle.stacker','order-picker':'vehicle.order-picker','vna-turret':'vehicle.vna','rough-terrain':'vehicle.rough-terrain',telehandler:'vehicle.telehandler','pallet-truck-manual':'vehicle.pallet-truck','pallet-truck-electric':'vehicle.pallet-truck','tow-tractor':'vehicle.tow-tractor','transport-cart':'vehicle.manual-cart'},
 robot:{'articulated-general':'robot.articulated','articulated-process':'robot.process',collaborative:'robot.collaborative',scara:'robot.scara',delta:'robot.delta',cartesian:'robot.cartesian',palletizer:'robot.four-axis-palletizer',amr:'mobile.amr-platform',agv:'mobile.agv-platform',shuttle:'mobile.rgv','cylindrical-rpp':'robot.cylindrical','polar-rrp':'robot.polar','mobile-manipulator':'robot.mobile-manipulator','mobile-sorter-crossbelt':'robot.mobile-sorter-crossbelt','mobile-sorter-tilttray':'robot.mobile-sorter-tilttray'},
 palletQueue:{selective:'storage.selective','double-deep':'storage.double-deep','drive-in':'storage.drive-in','drive-through':'storage.drive-through','pallet-flow':'storage.pallet-flow','push-back':'storage.push-back',mobile:'storage.mobile',cantilever:'storage.cantilever','light-duty':'storage.light-medium','medium-duty':'storage.light-medium','carton-flow':'storage.carton-flow',mezzanine:'storage.mezzanine','vertical-lift':'storage.vertical-lift',miniload:'storage.miniload'},
 product:{'box-small':'product.carton','box-medium':'product.carton','box-large':'product.carton','carton-bundle':'product.carton-bundle',crate:'product.crate',tote:'product.tote',bottle:'product.bottle-can-tray',jerrycan:'product.jerrycan',drum:'product.drum',sack:'product.sack',cylinder:'product.cylinder',reel:'product.reel','pallet-euro':'product.wood-pallet','pallet-industrial':'product.wood-pallet','pallet-plastic':'product.plastic-pallet','pallet-loaded':'product.loaded-pallet',cage:'product.pallet-cage'}
};
const CATALOGUE_EQUIVALENTS={
 'vehicle.pallet-truck-manual':'vehicle.pallet-truck','vehicle.pallet-truck-electric':'vehicle.pallet-truck',
 'product.standard-pallet':'product.wood-pallet'
};
const TITLES={
 'transport.roller-box':'Rodillos motorizados para cajas','transport.flat-belt':'Bandas planas','transport.roller-gravity':'Rodillos por gravedad','transport.pallet-chain':'Cadenas para pallets','transport.curve':'Curvas de rodillos','transport.belt-curve':'Curvas de banda','transport.modular-curve':'Curvas de banda modular','transport.belt-incline':'Bandas inclinadas','transport.modular-incline':'Bandas modulares inclinadas','transport.popup-transfer':'Transferencias emergentes a 90°','transport.turntable':'Mesas giratorias','transport.zero-pressure':'Acumuladores de rodillos por zonas','transport.belt-zones':'Acumuladores de banda por zonas','transport.vertical-lift':'Elevadores de plataforma','transport.manual-station':'Estaciones de carga manual','transport.automatic-station':'Estaciones de carga automática',
 'vehicle.counterbalance':'Montacargas contrabalanceados','vehicle.pallet-truck':'Transpaletas','vehicle.manual-cart':'Carros de plataforma','vehicle.reach-truck':'Montacargas retráctiles','vehicle.stacker':'Apiladores','vehicle.order-picker':'Preparadores de pedidos','vehicle.vna':'Montacargas trilaterales VNA','vehicle.rough-terrain':'Montacargas todoterreno','vehicle.telehandler':'Manipuladores telescópicos','vehicle.tow-tractor':'Tractores de arrastre',
 'robot.articulated':'Robots articulados de seis ejes','robot.process':'Articulados de proceso','robot.four-axis-palletizer':'Robots paletizadores de cuatro ejes','robot.collaborative':'Brazos colaborativos','robot.scara':'Robots SCARA','robot.delta':'Robots delta','robot.cartesian':'Robots cartesianos XYZ','robot.cylindrical':'Robots cilíndricos RPP','robot.polar':'Robots polares RRP','robot.mobile-manipulator':'Manipuladores móviles',
 'storage.light-medium':'Estanterías de baldas para picking','product.carton':'Cajas de cartón','product.wood-pallet':'Pallets de madera','product.plastic-pallet':'Pallets de plástico','product.loaded-pallet':'Pallets cargados','product.roll-container':'Jaulas de transporte',
 'sensor.photoelectric':'Sensores de presencia fotoeléctricos','control.hmi':'Paneles HMI de mando'
};
const REPRESENTATIVES={'vehicle.counterbalance':'library:vehicle.forklift','robot.articulated':'library:vehicle.industrial','transport.roller-box':'library:conveyor.straight','product.carton':'library:product.box-medium'};
function keyFor(resource){
 if(!resource||resource.asset||resource.articleId||resource.origin==='project'||!String(resource.id||'').startsWith('library:')&&!resource.catalogueEquipmentId)return null;
 const catalogue=resource.catalogueEquipmentId;
 if(typeof catalogue==='string'&&/^equipment\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(catalogue)){
  const key=catalogue.slice(10);return CATALOGUE_EQUIVALENTS[key]||key;
 }
 const action=resource.action||{};if(action.type!=='prefab')return null;
 if(resource.id==='library:control.sensor')return 'sensor.photoelectric';
 if(resource.id==='library:control.panel')return 'control.hmi';
 const kind=String(resource.equipmentId||'').startsWith('conveyor.')?'conveyor':action.kind;
 const variant=resource.variant||action.variant;
 return Object.prototype.hasOwnProperty.call(NATIVE,kind)&&Object.prototype.hasOwnProperty.call(NATIVE[kind],variant)?NATIVE[kind][variant]:null;
}
function familyFor(resource,resources=[]){
 if(typeof resource==='string')resource=resources.find(row=>row.id===resource);
 const key=keyFor(resource);if(!key)return null;
 const location=taxonomy.cataloguePath({catalogueEquipmentId:'equipment.'+key})||taxonomy.location(resource),definition=equipment.definition('equipment.'+key);
 return {id:'family:'+key,key,name:TITLES[key]||definition&&definition.title||resource.definition&&resource.definition.name||resource.name,description:'Variantes de una misma familia técnica; cada opción conserva su modelo, configuración y funcionamiento propios.',group:location.group,subgroup:location.subgroup};
}
function listFamilies(resources=[],options={}){
 const families=new Map();
 for(const resource of resources){const family=familyFor(resource);if(!family)continue;if(!families.has(family.id))families.set(family.id,{...family,variants:[],variantIds:[]});const row=families.get(family.id);if(row.variantIds.includes(resource.id))continue;row.variants.push(resource);row.variantIds.push(resource.id);}
 return [...families.values()].filter(row=>row.variants.length>=(options.minVariants||1)).map(row=>{
  const representative=row.variants.find(r=>r.id===options.selectedId)||row.variants.find(r=>r.id===REPRESENTATIVES[row.key])||row.variants.find(r=>r.id.startsWith('library:')&&!r.aliasOf)||row.variants[0];
  return {...row,representativeId:representative.id,count:row.variants.length};
 });
}
function listVariants(familyOrId,resources=[]){const id=typeof familyOrId==='string'?familyOrId:familyOrId&&familyOrId.id;if(!resources.length&&familyOrId&&Array.isArray(familyOrId.variants))return familyOrId.variants.slice();return resources.filter(resource=>{const family=familyFor(resource);return family&&family.id===id;});}
function resolve(id,resources=[]){const exact=resources.find(resource=>resource.id===id);if(exact)return exact;const family=listFamilies(resources).find(row=>row.id===id);return family?resources.find(row=>row.id===family.representativeId):null;}
function configuration(resource){
 const action=resource&&resource.action;if(!action||action.type!=='prefab')return null;
 // This is a link to the existing inspector contract, not an alternative
 // normalizer or a promise that every metadata label is an editable field.
 const fields=(resource.definition&&resource.definition.parameters||[]).filter(field=>field&&typeof field==='object'&&typeof field.key==='string');
 return {kind:action.kind,variant:action.variant,catalogueEquipmentId:resource.catalogueEquipmentId||'',fields:fields.map(field=>JSON.parse(JSON.stringify(field))),preset:JSON.parse(JSON.stringify({...((resource.definition&&resource.definition.preset)||{}),...action.config})),requiresNativeValidation:true};
}
module.exports={familyFor,listFamilies,listVariants,resolve,configuration,group:listFamilies};
