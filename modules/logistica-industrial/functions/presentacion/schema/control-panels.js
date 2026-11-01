'use strict';

// Visual choices are data shared by authoring and native prefab factories.
// They never change PLC commands, machine logic or persisted component paths.
const DESIGNS = [
  {id:'auto',name:'Automático según la máquina'},
  {id:'compact',name:'Botonera compacta sobre pedestal'},
  {id:'pendant',name:'Terminal de programación de robot'},
  {id:'console',name:'Consola HMI inclinada'},
  {id:'cabinet',name:'Armario industrial con baliza'}
];
const SPECS = {
  compact:{width:1.10,height:.90,depth:.19,centerY:.20,screen:[.76,.20,0,.46],columns:.29,rows:[.21,.04,-.13],captionWidth:.20,captionHeight:.027,captionDrop:.084,titleY:.605,tilt:0,tower:false,body:'#45616d',door:'#65848d',trim:'#182b33'},
  pendant:{width:1.25,height:.86,depth:.16,centerY:.18,screen:[.74,.34,0,.25],captionWidth:.145,captionHeight:.027,captionDrop:.084,titleY:.568,tilt:0,tower:false,body:'#1f3038',door:'#344c56',trim:'#0b1b22',controls:{start:[-.51,.22],stop:[-.51,.05],pause:[-.51,-.12],emergency:[.51,.22],powerOn:[.51,.05],powerOff:[.51,-.12],speedDown:[-.25,-.10],speedUp:[.25,-.10],insertBox:[0,-.10],dispatch:[0,-.10]}},
  console:{width:1.44,height:.88,depth:.32,centerY:.12,screen:[.62,.32,-.32,.28],captionWidth:.145,captionHeight:.027,captionDrop:.084,titleY:.51,tilt:-.30,tower:false,body:'#718892',door:'#96aab1',trim:'#1a303b',controls:{start:[.28,.14],stop:[.28,-.03],emergency:[.55,.14],pause:[.55,-.03],powerOff:[.28,-.20],powerOn:[.55,-.20],speedDown:[-.52,-.16],speedUp:[.02,-.16],insertBox:[-.25,-.16],dispatch:[-.25,-.16]}},
  cabinet:{width:1.02,height:1,depth:.28,centerY:.21,screen:[.74,.28,0,.47],columns:.29,rows:[.21,.04,-.13],captionWidth:.22,titleY:.655,tilt:0,tower:true,body:'#abb5be',door:'#a9b4bd',trim:'#202d39'}
};
function resolve(value={},kind='conveyor') {
 const requested=value.panelDesign === undefined ? 'auto' : value.panelDesign;
 if(!DESIGNS.some(item=>item.id===requested))throw Error('Diseño de panel no compatible.');
 if(requested!=='auto')return requested;
 if(kind==='plc')return 'cabinet';
 if(kind==='robot')return ['amr','agv','mobileSorter','shuttle'].includes(value.family)?'compact':'pendant';
 if(['elevator','distributor','zones'].includes(value.mechanism))return 'cabinet';
 if(['turntable','liftTransfer','pusher','steer','merge'].includes(value.mechanism)||value.surface==='belt'||value.surface==='modular')return 'console';
 return 'compact';
}
function spec(value,kind){const id=resolve(value,kind);return Object.assign({id},SPECS[id]);}
function field(){return {key:'panelDesign',label:'Modelo del panel de control',input:'select',default:'auto',options:DESIGNS.map(item=>({value:item.id,label:item.name}))};}
module.exports={DESIGNS,resolve,spec,field};
