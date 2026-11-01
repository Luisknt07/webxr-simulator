'use strict';

// Visual choices are data shared by authoring and native prefab factories.
// They never change PLC commands, machine logic or persisted component paths.
const DESIGNS = [
  {id:'auto',name:'Automático según la máquina'},
  {id:'compact',name:'Botonera compacta sobre pedestal'},
  {id:'pendant',name:'Terminal de programación de robot'},
  {id:'console',name:'Consola HMI inclinada'},
  {id:'cell-console',name:'Consola de celda · armario de piso y teclado'},
  {id:'cabinet',name:'Armario industrial con baliza'}
];
const SPECS = {
  'cell-console':{width:1.15,height:.88,depth:.54,centerY:0,screen:[.70,.29,-.15,.19],captionWidth:.15,captionHeight:.024,captionDrop:.069,titleY:.405,tilt:-.50,tower:true,body:'#46515a',door:'#a6b0b4',trim:'#1b2c35',controls:{start:[-.44,-.10],stop:[-.23,-.10],pause:[-.02,-.10],powerOn:[.20,-.10],emergency:[.46,-.10],powerOff:[-.44,-.28],speedDown:[-.23,-.28],speedUp:[.20,-.28],dispatch:[-.02,-.28],insertBox:[-.02,-.28],generate:[-.02,-.28]}},
  compact:{width:1.10,height:.90,depth:.19,centerY:.20,screen:[.76,.20,0,.46],columns:.29,rows:[.21,.04,-.13],captionWidth:.20,captionHeight:.027,captionDrop:.084,titleY:.605,tilt:0,tower:false,body:'#45616d',door:'#65848d',trim:'#182b33'},
  pendant:{width:1.25,height:.86,depth:.16,centerY:.18,screen:[.74,.34,0,.25],captionWidth:.145,captionHeight:.027,captionDrop:.084,titleY:.568,tilt:0,tower:false,body:'#1f3038',door:'#344c56',trim:'#0b1b22',controls:{start:[-.51,.22],stop:[-.51,.05],pause:[-.51,-.12],emergency:[.51,.22],powerOn:[.51,.05],powerOff:[.51,-.12],speedDown:[-.25,-.10],speedUp:[.25,-.10],insertBox:[0,-.10],dispatch:[0,-.10]}},
  console:{width:1.36,height:1,depth:.32,centerY:.17,screen:[.88,.34,-.13,.40],captionWidth:.18,captionHeight:.027,captionDrop:.084,titleY:.620,tilt:-.22,tower:false,body:'#344650',door:'#84959d',trim:'#14232d',controls:{start:[-.48,.14],stop:[-.24,.14],pause:[0,.14],powerOn:[.24,.14],powerOff:[.48,-.10],emergency:[.54,.174],speedDown:[-.24,-.10],speedUp:[.24,-.10],insertBox:[0,-.10],dispatch:[0,-.10],generate:[0,-.10]}},
  cabinet:{width:1.02,height:1,depth:.28,centerY:.21,screen:[.74,.28,0,.47],columns:.29,rows:[.21,.04,-.13],captionWidth:.22,titleY:.655,tilt:0,tower:true,body:'#abb5be',door:'#a9b4bd',trim:'#202d39'}
};
function resolve(value={},kind='conveyor') {
 const requested=value.panelDesign === undefined ? 'auto' : value.panelDesign;
 if(!DESIGNS.some(item=>item.id===requested))throw Error('Diseño de panel no compatible.');
 if(requested!=='auto')return requested;
 if(kind==='plc')return 'cabinet';
 if(kind==='robot'){
  if(value.variant==='articulated-general'&&value.family==='articulated'&&value.visualModel!=='legacy')return 'cell-console';
  return ['amr','agv','mobileSorter','shuttle'].includes(value.family)?'compact':value.family==='cobot'?'pendant':'console';
 }
 if(['elevator','distributor','zones'].includes(value.mechanism))return 'cabinet';
 if(['turntable','liftTransfer','pusher','steer','merge'].includes(value.mechanism)||value.surface==='belt'||value.surface==='modular')return 'console';
 return 'compact';
}
function spec(value,kind){const id=resolve(value,kind);return Object.assign({id},SPECS[id]);}
function field(){return {key:'panelDesign',label:'Modelo del panel de control',input:'select',default:'auto',options:DESIGNS.map(item=>({value:item.id,label:item.name}))};}
function controlPosition(design,action,index){
 const mapped=design.controls&&design.controls[action];
 if(mapped&&mapped.length===2&&mapped.every(Number.isFinite))return mapped.slice();
 const columns=Number.isFinite(design.columns)?design.columns:.29,rows=design.rows||[.21,.04,-.13];
 return [((index%3)-1)*columns,rows[Math.min(rows.length-1,Math.floor(index/3))]];
}
// Pure local pose shared by the factory and saved-project migration. This must
// not allocate a model just to upgrade a room that has not been opened yet.
function controlPose(design,action,index,legacy=false){
 const xy=controlPosition(design,action,index),z=legacy ? .17 : .14+.021*design.depth/.28+.0115;
 const centerZ=.14-design.depth/2,dy=xy[1]-design.centerY,dz=z-centerZ,c=Math.cos(design.tilt),s=Math.sin(design.tilt);
 return {position:[xy[0],design.centerY+dy*c-dz*s,centerZ+dy*s+dz*c],quaternion:[Math.sin(design.tilt/2),0,0,Math.cos(design.tilt/2)]};
}
module.exports={DESIGNS,resolve,spec,field,controlPosition,controlPose};
