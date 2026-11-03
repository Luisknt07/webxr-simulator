import {createIndustrialPrefab} from '../../../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js';
import schema from '../../../../modules/logistica-industrial/contracts/behaviors.js';

// A resource preset configures a NEW instance. It never mutates the catalogue,
// a placed actor or the scene's materials while browsing variants.
const cache = new Map(), LIMIT = 80;
const KEYS = {
  conveyor: ['length','width','supportHeight','speed','radius','curveAngle','rise','withSensors','withPanel'],
  vehicle: ['length','width','height','speed','payloadKg','maxLift','forkLength','forkSpread','wear'],
  robot: ['reach','height','payloadKg','speed','tool','panelDesign','pendantDesign','withPanel','wear'],
  palletQueue: ['width','depth','rows','columns','layers','capacity'],
  rack: ['rackBays','rackLevels','rackColumns','rackDepthSlots','rackBayWidth','rackSlotDepth','rackLevelHeight','rackClearance','rackAisleWidth'],
  processor: ['length','width','processTime','setupTime','capacity','parallelism','withPanel'],
  source: ['width','height','depth','capacity','interval','mass','withPanel'],
  product: ['width','height','depth','mass','units','quality']
};
const clone = value => JSON.parse(JSON.stringify(value));
function dispose(root) {
  const geometry = new Set(), materials = new Set(), textures = new Set();
  root.traverse(node => {if(node.geometry)geometry.add(node.geometry);for(const material of (Array.isArray(node.material)?node.material:[node.material]).filter(Boolean)){materials.add(material);for(const key of Object.keys(material))if(material[key]&&material[key].isTexture)textures.add(material[key]);}});
  textures.forEach(value=>{if(!(value.userData&&value.userData.sharedIndustrialTexture))value.dispose();});materials.forEach(value=>value.dispose());geometry.forEach(value=>value.dispose());
}
function supported(resource) {return !!(resource&&resource.action&&resource.action.type==='prefab'&&resource.status!=='development'&&KEYS[resource.action.kind]);}
function baseFor(resource) {
  if(!supported(resource))return null;
  const action=resource.action,key=JSON.stringify([resource.id,resource.version,action.kind,action.variant,action.config]);
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
  const object=createIndustrialPrefab(action.kind,action.variant);let base;
  try {base=(object.userData.editorDefaultBehaviors||[]).find(config=>config.type===action.kind);if(!base)return null;base=clone(base);} finally {dispose(object);}
  const rack=base.type==='palletQueue'&&schema.warehouseRacks.isRack(base),keys=KEYS[rack?'rack':base.type].slice();
  // Geometry-specific choices stay on their actual mechanism. A straight belt
  // does not acquire a radius, nor a hand pallet truck a telescopic mast.
  if(base.type==='conveyor'){
    if(!/^curve/i.test(base.layout||''))for(const key of ['radius','curveAngle'])keys.splice(keys.indexOf(key),1);
    if(!/incline|elevator|spiral/i.test([action.variant,base.layout,base.family].join(' ')))keys.splice(keys.indexOf('rise'),1);
  }
  if(base.type==='vehicle'&&!/forklift|reach|stacker|turret|order-picker|telehandler/.test(base.variant||''))for(const key of ['maxLift','forkLength','forkSpread'])keys.splice(keys.indexOf(key),1);
  // Mobile carriers and some catalogue vehicles reuse a robot runtime, but do
  // not acquire an articulated arm or its tools/pendant in the resource sheet.
  if(base.type==='robot'&&(/^equipment\.(vehicle|mobile)\./.test(base.catalogueEquipmentId||'')||['agv','amr','shuttle'].includes(base.variant))){
    for(const key of ['reach','tool','panelDesign','pendantDesign']){const index=keys.indexOf(key);if(index>=0)keys.splice(index,1);}
  }
  const definitions=schema.fieldsFor(base);
  const fields=keys.map(key=>definitions.find(field=>field.key===key)).filter(field=>field&&['number','select','checkbox'].includes(field.input)&&base[field.key]!==undefined).map(field=>{
    const out={key:field.key,label:field.label,type:field.input==='checkbox'?'checkbox':field.input,value:base[field.key]};
    if(field.input==='number')Object.assign(out,{min:field.min,max:field.max,step:field.step||.01});
    if(base.type==='product'&&out.key==='height'&&base.catalogueEquipmentId==='equipment.product.slip-sheet')out.min=.001;
    if(field.input==='select')out.options=clone(field.options);
    // Keep the resource preview bounded; detailed instance authoring remains in
    // Objeto. The ordinary native schema still validates every final value.
    if(out.key==='length')out.max=Math.min(out.max,Math.max(20,out.value));
    if(rack&&out.key==='rackBays')out.max=Math.min(out.max,Math.max(4,out.value));
    if(rack&&out.key==='rackLevels')out.max=Math.min(out.max,Math.max(4,out.value));
    return out;
  });
  const result={base,fields};cache.set(key,result);while(cache.size>LIMIT)cache.delete(cache.keys().next().value);return result;
}
export function describe(resource) {
  const value=baseFor(resource);if(!value)return{fields:[],values:{}};
  return {fields:clone(value.fields),values:Object.fromEntries(value.fields.map(field=>[field.key,value.base[field.key]]))};
}
export function normalize(resource,parameters={}) {
  if(!parameters||Array.isArray(parameters)||![Object.prototype,null].includes(Object.getPrototypeOf(parameters)))throw new Error('La configuración del recurso debe contener parámetros válidos.');
  const descriptor=baseFor(resource),fields=descriptor&&descriptor.fields||[],patch={};
  if(Object.keys(parameters).length>24)throw new Error('Demasiados parámetros de recurso.');
  for(const key of Object.keys(parameters)){
    const field=fields.find(row=>row.key===key),value=parameters[key];
    if(!field||['__proto__','constructor','prototype'].includes(key))throw new Error('Parámetro de recurso no disponible: '+key);
    if(field.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<field.min||value>field.max||field.step===1&&!Number.isInteger(value)))throw new Error('Valor fuera de rango: '+field.label);
    if(field.type==='checkbox'&&typeof value!=='boolean')throw new Error('Valor inválido: '+field.label);
    if(field.type==='select'&&!field.options.some(option=>(typeof option==='object'?option.value:option)===value))throw new Error('Opción no disponible: '+field.label);
    patch[key]=value;
  }
  if(descriptor&&Object.keys(patch).length)schema.normalizeBehaviors([Object.assign({},descriptor.base,patch)]);
  return patch;
}
export function createConfiguredPrefab(resource,parameters={}) {
  if(!resource||!resource.action||resource.action.type!=='prefab')throw new Error('El recurso no es un equipo insertable.');
  return createIndustrialPrefab(resource.action.kind,resource.action.variant,normalize(resource,parameters));
}
export function applyToObject(document,object,resource,parameters={}) {
  const patch=normalize(resource,parameters);if(!Object.keys(patch).length)return object;
  const kind=resource.action.kind,behaviors=document.getBehaviors(object);
  if(!behaviors.some(config=>config.type===kind))throw new Error('La instancia no tiene la función del recurso.');
  document.setBehaviors(object,behaviors.map(config=>config.type===kind?Object.assign({},config,patch):config));return object;
}
export default {describe,normalize,createConfiguredPrefab,applyToObject};
