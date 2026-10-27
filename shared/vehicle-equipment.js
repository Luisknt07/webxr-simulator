'use strict';
const vehicles=require('./vehicles.js');
const REFERENCES=[{title:'Toyota · truck types',url:'https://www.toyotamaterialhandling-international.com/knowledge/truck-types'},
  {title:'Toyota · Moving Mast Reach Truck',url:'https://www.toyotaforklift.com/lifts/electric-reach-trucks/moving-mast-reach-truck'},
  {title:'Crown · VNA turret',url:'https://www.crown.com/en-us/forklifts/man-up-order-pickers/tsp-turret-stockpicker.html'},
  {title:'Manitou · MT625 mechanical functions',url:'https://www.manitou.com/en-US/our-machines/fixed-telehandlers/mt-625-h'},
  {title:'Jungheinrich · carrying capacity',url:'https://www.jungheinrich-profishop.co.uk/en/profi-guide/carrying-capacity/'}];
const definitions=vehicles.VARIANTS.map(item=>({id:item.id,name:item.name,family:item.family,kind:'vehicle',status:'functional',preset:vehicles.defaults(item.id),
  description:item.family==='tow'?'Tractor conducible con enganche articulado para carro; la carga remolcada no se eleva.':item.family==='cart'?'Plataforma móvil/remolcable para una carga compatible.':'Vehículo conducible con mecanismos propios, entrada física de horquillas y carga identificada; modelo cinemático didáctico.',
  components:['Chasis','Rodadura y dirección','Puesto de conducción',...(vehicles.supports(item).forks?['Portahorquillas','Mecanismo de elevación','Hidráulica']:['Enganche']), 'Indicadores y luces'],
  parameters:vehicles.fields(),references:REFERENCES,features:vehicles.supports(item.preset)}));
module.exports={definitions,variants:definitions.map(item=>item.id),families:vehicles.FAMILIES,references:REFERENCES,getDefinition:id=>definitions.find(item=>item.id===String(id).replace(/^vehicle\./,''))||null};
