'use strict';
// Curated parts share the native serial-six bearing interfaces. These are
// generic teaching assemblies, not manufacturer payload or safety ratings.
const PARTS={
 baseAssembly:[['compact-pedestal','Pedestal compacto atornillado'],['anchored-drum','Zócalo industrial con corona'],['wide-floor','Base ancha de anclaje al piso']],
 shoulderAssembly:[['compact-yoke','Yugo compacto con servo lateral'],['cast-offset','Hombro industrial de fundición'],['reinforced-yoke','Horquilla reforzada con doble apoyo']],
 upperArmAssembly:[['compact-cast','Brazo compacto de fundición'],['industrial-cast','Brazo industrial CAD adaptado'],['ribbed-cast','Eslabón con nervios y tapas'],['slim-tube','Perfil cerrado de largo alcance'],['heavy-box','Brazo de sección reforzada']],
 forearmAssembly:[['compact-drive','Antebrazo compacto con accionamiento'],['hollow-drive','Transmisión hueca industrial'],['enclosed-drive','Antebrazo con cubierta de servicio'],['slim-tube','Perfil estrecho de alcance'],['heavy-drive','Antebrazo de carga reforzado']],
 wristAssembly:[['compact-inline','Muñeca compacta en línea'],['service-wrist','Muñeca industrial con carcasa'],['reinforced-inline','Muñeca reforzada con brida']]
};
const profile=(id,name,parts,allowed)=>({id,name,parts,allowed});
const profiles=[
 profile('compact-training','Compacto de formación',{baseAssembly:'compact-pedestal',shoulderAssembly:'compact-yoke',upperArmAssembly:'compact-cast',forearmAssembly:'compact-drive',wristAssembly:'compact-inline'},{baseAssembly:['compact-pedestal','anchored-drum'],shoulderAssembly:['compact-yoke'],upperArmAssembly:['compact-cast','slim-tube'],forearmAssembly:['compact-drive','slim-tube'],wristAssembly:['compact-inline']}),
 profile('industrial-six-axis','Industrial de seis ejes',{baseAssembly:'anchored-drum',shoulderAssembly:'cast-offset',upperArmAssembly:'industrial-cast',forearmAssembly:'hollow-drive',wristAssembly:'service-wrist'},{baseAssembly:['anchored-drum','wide-floor'],shoulderAssembly:['cast-offset'],upperArmAssembly:['industrial-cast','ribbed-cast'],forearmAssembly:['hollow-drive','enclosed-drive'],wristAssembly:['service-wrist','reinforced-inline']}),
 profile('long-reach','Industrial de largo alcance',{baseAssembly:'wide-floor',shoulderAssembly:'cast-offset',upperArmAssembly:'slim-tube',forearmAssembly:'slim-tube',wristAssembly:'compact-inline'},{baseAssembly:['wide-floor','anchored-drum'],shoulderAssembly:['cast-offset','reinforced-yoke'],upperArmAssembly:['slim-tube','ribbed-cast'],forearmAssembly:['slim-tube','hollow-drive'],wristAssembly:['compact-inline','service-wrist']}),
 profile('heavy-handling','Manipulación reforzada',{baseAssembly:'wide-floor',shoulderAssembly:'reinforced-yoke',upperArmAssembly:'heavy-box',forearmAssembly:'heavy-drive',wristAssembly:'reinforced-inline'},{baseAssembly:['wide-floor'],shoulderAssembly:['reinforced-yoke'],upperArmAssembly:['heavy-box','ribbed-cast'],forearmAssembly:['heavy-drive','enclosed-drive'],wristAssembly:['reinforced-inline']})
];
const keys=Object.keys(PARTS),profileOf=value=>profiles.find(p=>p.id===(value&&value.assemblyProfile==='auto'||!value||!value.assemblyProfile?'industrial-six-axis':value.assemblyProfile));
function partChoices(key,value){if(!PARTS[key])return [];const p=profileOf(value);return PARTS[key].map(([id,name])=>({id,name,compatible:!p||p.allowed[key].includes(id)}));}
function resolve(value={}){
 const profile=profileOf(value);if(!profile)throw Error('Perfil de ensamblaje de robot desconocido.');
 const parts={},effectivePartNames={};
 for(const key of keys){const requested=value[key]||'auto',id=requested==='auto'?profile.parts[key]:requested;if(!profile.allowed[key].includes(id))throw Error('Pieza incompatible con '+profile.name+': '+key+' = '+id+'. Usa Automático o una pieza compatible.');parts[key]=id;effectivePartNames[key]=PARTS[key].find(row=>row[0]===id)[1];}
 return {id:profile.id,name:profile.name,interface:'native-serial-six-v1',parts,effectivePartNames,changesNativeFrames:false};
}
function validate(value){return resolve(value);}
module.exports={profiles,PARTS,keys,partChoices,resolve,validate};
