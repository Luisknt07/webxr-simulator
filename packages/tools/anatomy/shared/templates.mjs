import {createPart,normalizeModel} from './model.mjs';
export const MATERIAL_PRESETS=Object.freeze([
 {id:'paint-orange',name:'Pintura naranja',color:'#e68a28',metalness:.35,roughness:.4,opacity:1},
 {id:'paint-yellow',name:'Pintura amarilla',color:'#dfba28',metalness:.3,roughness:.42,opacity:1},
 {id:'paint-blue',name:'Estructura azul',color:'#315672',metalness:.5,roughness:.43,opacity:1},
 {id:'steel',name:'Acero mecanizado',color:'#aebdc5',metalness:.86,roughness:.27,opacity:1},
 {id:'dark',name:'Polímero y caucho',color:'#26313a',metalness:.05,roughness:.72,opacity:1},
 {id:'glass',name:'Carcasa transparente',color:'#82cdd9',metalness:.1,roughness:.2,opacity:.28},
 {id:'green',name:'Indicador verde',color:'#65c69a',metalness:.08,roughness:.38,opacity:1},
 {id:'red',name:'Indicador rojo',color:'#d25a53',metalness:.08,roughness:.4,opacity:1},
 {id:'wood',name:'Madera de pallet',color:'#b9a47b',metalness:0,roughness:.84,opacity:1},
 {id:'cardboard',name:'Cartón',color:'#c7b994',metalness:0,roughness:.88,opacity:1}
].map(Object.freeze));
const mat=id=>({...MATERIAL_PRESETS.find(value=>value.id===id)});
const material=id=>{const {name,...value}=mat(id);delete value.id;return value;};
const PI=Math.PI;
function design(name){
 const parts=[],groups=[];
 const group=(id,title,motion,parentId)=>{groups.push({id,name:title,...(motion?{motion}:{}),...(parentId?{parentId}:{})});return id;};
 const add=(shape,name,parameters,position=[0,0,0],rotation=[0,0,0],finish='steel',groupId,explode)=>{const part=createPart(shape,{id:'part-'+String(parts.length+1).padStart(3,'0'),name,parameters,position,rotation,material:typeof finish==='string'?material(finish):finish,explode:explode||[position[0]*.35,.12+(parts.length%4)*.12,position[2]*.35],...(groupId?{groupId}:{})});parts.push(part);return part;};
 const box=(name,size,at,finish='steel',groupId,rotation=[0,0,0])=>add('box',name,{width:size[0],height:size[1],depth:size[2]},at,rotation,finish,groupId);
 const round=(name,size,at,finish='steel',groupId,radius=.035,rotation=[0,0,0])=>add('roundedBox',name,{width:size[0],height:size[1],depth:size[2],radius,segments:24},at,rotation,finish,groupId);
 const cylinder=(name,radius,height,at,finish='steel',groupId,rotation=[0,0,0])=>add('cylinder',name,{radius,height,segments:24},at,rotation,finish,groupId);
 const tube=(name,path,radius=.025,finish='steel',groupId)=>add('tube',name,{path,radius,segments:16},[0,0,0],[0,0,0],finish,groupId);
 const bar=(name,a,b,width=.05,finish='steel',groupId)=>tube(name,[a,b],width,finish,groupId);
 const finish=(view={})=>normalizeModel({format:'smarttwin.anatomy',version:1,units:'m',name,parts,groups,view});
 return {parts,group,add,box,round,cylinder,tube,bar,finish};
}
function robot(){
 const d=design('Brazo industrial · estructura y articulaciones'),base=d.group('base','Base fija'),upper=d.group('upper-arm','Hombro y brazo',{type:'hinge',axis:[0,0,1],pivot:[0,.58,0],min:-1.2,max:1.2,value:0},base),fore=d.group('forearm','Antebrazo',{type:'hinge',axis:[0,0,1],pivot:[.55,1.55,0],min:-1.5,max:1.5,value:0},upper),wrist=d.group('wrist','Muñeca y herramienta',{type:'hinge',axis:[0,0,1],pivot:[1.18,1.5,0],min:-1.5,max:1.5,value:0},fore);
 d.box('Placa de anclaje',[.86,.08,.76],[0,.04,0],'dark',base);d.cylinder('Corona de giro',.34,.18,[0,.17,0],'steel',base);d.round('Columna del robot',[.46,.48,.42],[0,.49,0],'paint-orange',base);
 d.cylinder('Articulación del hombro',.23,.54,[0,.64,0],'dark',upper,[PI/2,0,0]);
 d.round('Brazo superior',[.27,1.07,.3],[.275,1.095,0],'paint-orange',upper,.045,[0,0,-Math.atan2(.55,.91)]);
 d.cylinder('Articulación del codo',.19,.44,[.55,1.55,0],'dark',fore,[PI/2,0,0]);
 d.round('Antebrazo',[.23,.66,.25],[.865,1.525,0],'paint-orange',fore,.035,[0,0,-Math.atan2(.63,-.05)]);
 d.cylinder('Muñeca',.14,.3,[1.19,1.49,0],'steel',wrist,[0,0,PI/2]);d.box('Pinza · cuerpo',[.28,.12,.28],[1.36,1.43,0],'dark',wrist);
 for(const sign of [-1,1]){d.box('Dedo de pinza '+sign,[.06,.2,.06],[1.4,1.29,sign*.105],'steel',wrist);d.cylinder('Tapa del codo '+sign,.135,.035,[.55,1.55,sign*.24],'steel',fore,[PI/2,0,0]);}
 d.tube('Manguera de servicio',[[0,.45,-.25],[.1,.9,-.25],[.5,1.6,-.23],[.9,1.64,-.2],[1.18,1.52,-.18]],.026,'dark',base);
 for(const x of [-.3,.3])for(const z of [-.25,.25])d.cylinder('Perno de base',.035,.035,[x,.095,z],'steel',base);
 d.box('Cubierta electrónica',[.25,.25,.08],[-.04,.48,-.25],'paint-blue',base);
 return d.finish();
}
function forklift(){
 const d=design('Montacargas · cabina, mástil y horquillas'),frame=d.group('chassis','Chasis'),mast=d.group('mast','Mástil y carro',{type:'slide',axis:[0,1,0],pivot:[0,0,0],min:0,max:1.5,value:0},frame),cabin=d.group('cabin','Puesto del operador',null,frame);
 d.round('Chasis principal',[1.05,.35,1.6],[0,.43,0],'paint-yellow',frame,.07);d.round('Contrapeso',[1.06,.56,.45],[0,.7,-.68],'paint-yellow',frame,.08);
 for(const x of [-.55,.55])for(const z of [-.53,.53]){d.cylinder('Neumático',.29,.19,[x,.29,z],'dark',frame,[0,0,PI/2]);d.cylinder('Llanta',.14,.2,[x,.29,z],'steel',frame,[0,0,PI/2]);}
 d.box('Piso de cabina',[.75,.06,.72],[0,.66,.03],'dark',cabin);d.round('Asiento',[.45,.12,.43],[0,.96,-.21],'dark',cabin,.04);d.round('Respaldo',[.45,.43,.1],[0,1.18,-.4],'dark',cabin,.035,[.1,0,0]);
 for(const x of [-.47,.47])for(const z of [-.48,.42])d.box('Pilar protector',[.065,1.25,.065],[x,1.28,z],'dark',cabin);
 d.box('Protección superior',[1.08,.08,1.12],[0,1.94,-.03],'dark',cabin);
 for(let i=0;i<6;i++)d.box('Rejilla del techo',[.035,.045,1],[.07*(i-2.5),1.99,-.03],'steel',cabin);
 d.cylinder('Columna de dirección',.035,.4,[-.14,.98,.27],'steel',cabin,[.45,0,0]);d.add('torus','Volante',{radius:.17,tubeRadius:.018,segments:24,tubeSegments:8},[-.14,1.19,.35],[.55,0,0],'dark',cabin);
 for(const x of [.18,.27])d.bar('Palanca hidráulica',[x,.8,.2],[x,1.13,.22],.013,'steel',cabin);
 for(const x of [-.36,.36])d.box('Perfil del mástil',[.09,1.9,.13],[x,1.04,.9],'dark',mast);
 for(const y of [.17,1,1.95])d.box('Travesaño del mástil',[.82,.09,.12],[0,y,.9],'steel',mast);
 d.box('Carro portahorquillas',[.92,.3,.11],[0,.4,1.015],'steel',mast);
 for(const x of [-.25,.25]){d.box('Uña de inserción',[.12,.045,1.02],[x,.23,1.54],'steel',mast);d.box('Talón de la horquilla',[.12,.39,.07],[x,.4,1.06],'steel',mast);}
 d.cylinder('Cilindro de elevación',.06,1.3,[0,.94,.82],'steel',mast);
 for(const x of [-.37,.37])d.add('sphere','Faro frontal',{radius:.065,segments:16},[x,1.79,.47],[0,0,0],'glass',cabin);
 return d.finish();
}
function pallet(d,name,at,group){
 for(let i=0;i<5;i++)d.box(name+' · tabla superior',[.17,.035,.95],[at[0]+(i-2)*.2,at[1]+.13,at[2]],'wood',group);
 for(const x of [-.4,0,.4])for(const z of [-.36,0,.36])d.box(name+' · taco',[.14,.08,.14],[at[0]+x,at[1]+.07,at[2]+z],'wood',group);
 for(const x of [-.4,0,.4])d.box(name+' · apoyo',[.17,.025,.95],[at[0]+x,at[1]+.015,at[2]],'wood',group);
 d.round(name+' · carga',[.75,.45,.68],[at[0],at[1]+.375,at[2]],'cardboard',group,.015);
}
function rack(){
 const d=design('Estantería selectiva · dos módulos y pallets'),g=d.group('rack','Estructura'),stock=d.group('stock','Mercancía');
 for(const x of [-1.7,0,1.7])for(const z of [-.62,.62]){d.box('Montante perforado',[.075,2.75,.09],[x,1.375,z],'paint-blue',g);d.box('Placa de anclaje',[.19,.025,.19],[x,.0125,z],'steel',g);}
 for(const y of [.25,1.35,2.5])for(const x of [-.85,.85])for(const z of [-.62,.62])d.box('Larguero portapallet',[1.7,.105,.075],[x,y,z],'paint-orange',g);
 for(const x of [-1.7,1.7]){d.bar('Arriostramiento diagonal A',[x,.2,-.6],[x,1.4,.6],.018,'steel',g);d.bar('Arriostramiento diagonal B',[x,1.4,.6],[x,2.65,-.6],.018,'steel',g);}
 for(const x of [-.85,.85])for(const y of [.3,1.4,2.55])d.box('Soporte del pallet',[.05,.035,1.25],[x,y,0],'steel',g);
 pallet(d,'Pallet A01-R01-B01-N01',[-.85,.32,0],stock);pallet(d,'Pallet A01-R01-B02-N02',[.85,1.42,0],stock);
 return d.finish();
}
function conveyor(){
 const d=design('Transportador de rodillos · motor y sensórica'),frame=d.group('frame','Bastidor'),rollers=d.group('rollers','Rodillos'),control=d.group('controls','Accionamiento y control');
 for(const x of [-.64,.64])d.box('Larguero de banda',[.1,.15,3.1],[x,.85,0],'paint-blue',frame);
 for(const x of [-.55,.55])for(const z of [-1.25,1.25]){d.box('Pata regulable',[.075,.75,.075],[x,.4,z],'steel',frame);d.box('Placa de pie',[.19,.035,.19],[x,.025,z],'dark',frame);}
 for(let i=0;i<13;i++)d.cylinder('Rodillo '+String(i+1).padStart(2,'0'),.075,1.18,[0,.89,(i-6)*.23],'steel',rollers,[0,0,PI/2]);
 d.cylinder('Motor eléctrico',.16,.32,[.93,.66,.7],'paint-blue',control,[0,0,PI/2]);d.cylinder('Reductor',.13,.18,[.7,.66,.7],'steel',control,[0,0,PI/2]);
 d.box('Columna de control',[.07,1.2,.07],[1.05,.6,-.9],'steel',control);d.round('Armario de control',[.45,.53,.16],[1.05,1.36,-.9],'steel',control,.025);
 d.box('Pantalla de estado',[.3,.14,.014],[1.05,1.5,-.81],'dark',control);
 for(const [i,color] of ['green','red','paint-yellow'].entries())d.cylinder('Pulsador '+(i+1),.043,.03,[.92+i*.13,1.27,-.8],color,control,[PI/2,0,0]);
 for(const z of [-1.35,1.35])d.box('Sensor de presencia',[.065,.07,.055],[-.58,1.01,z],'dark',control);
 d.round('Caja transportada',[.64,.4,.64],[0,1.17,.3],'cardboard',frame,.02);
 d.tube('Cable de alimentación',[[1.05,1.1,-.9],[1.05,.46,-.9],[.78,.46,.65]],.012,'dark',control);
 return d.finish();
}
function pump(){
 const d=design('Bomba centrífuga · vista de componentes'),base=d.group('base','Bancada'),casing=d.group('casing','Carcasa transparente'),rotor=d.group('rotor','Impulsor',{type:'hinge',axis:[1,0,0],pivot:[-.45,.68,0],min:0,max:PI*2,value:0},base),motor=d.group('motor','Motor y acoplamiento');
 d.round('Bancada',[2.2,.14,1.05],[0,.1,0],'paint-blue',base,.04);
 d.add('lathe','Carcasa seccionada',{profile:[[.3,-.23],[.5,-.12],[.5,.12],[.3,.23]],segments:32},[-.45,.68,0],[0,0,PI/2],'glass',casing);
 d.cylinder('Disco del impulsor',.4,.055,[-.45,.68,0],'steel',rotor,[0,0,PI/2]);
 for(let i=0;i<8;i++){const t=i*PI/4;d.round('Álabe '+(i+1),[.06,.25,.11],[-.505,.68+Math.cos(t)*.24,Math.sin(t)*.24],'paint-orange',rotor,.02,[t-.5,0,0]);}
 d.cylinder('Eje de transmisión',.055,1.3,[.05,.68,-.05],'steel',motor,[0,0,PI/2]);
 d.cylinder('Acoplamiento flexible',.13,.2,[.2,.68,-.05],'dark',motor,[0,0,PI/2]);d.cylinder('Motor · estator',.28,.75,[.76,.68,-.05],'paint-blue',motor,[0,0,PI/2]);
 for(let i=0;i<6;i++)d.add('torus','Aleta de refrigeración',{radius:.278,tubeRadius:.014,segments:24,tubeSegments:6},[.47+i*.11,.68,-.05],[0,0,PI/2],'steel',motor);
 d.tube('Conducto de aspiración',[[-.65,.68,0],[-1.15,.68,0],[-1.3,.35,0]],.12,'steel',casing);d.tube('Conducto de descarga',[[-.45,1.05,0],[-.45,1.4,0],[0,1.4,0]],.095,'steel',casing);
 for(const x of [-.75,.52,.96])d.box('Pie del conjunto',[.2,.35,.5],[x,.35,0],'paint-blue',base);
 for(const x of [-.9,.9])for(const z of [-.36,.36])d.cylinder('Perno de bancada',.032,.04,[x,.2,z],'steel',base);
 return d.finish({mode:'transparent',explode:.12});
}
function controller(){
 const d=design('Panel de mando · señales y ergonomía'),housing=d.group('housing','Armario'),interfaceGroup=d.group('interface','Interfaz de operación');
 d.box('Base del pedestal',[.65,.06,.5],[0,.03,0],'dark',housing);d.box('Pedestal',[.09,1,.09],[0,.55,0],'steel',housing);d.round('Armario metálico',[.7,.8,.22],[0,1.36,0],'steel',housing,.04);d.box('Placa frontal',[.65,.75,.016],[0,1.36,.12],'paint-blue',interfaceGroup);
 d.round('Pantalla táctil',[.44,.22,.026],[0,1.56,.145],'dark',interfaceGroup,.01);d.box('Lectura de pantalla',[.35,.115,.012],[0,1.56,.163],{color:'#68c8cf',metalness:0,roughness:.4,opacity:1},interfaceGroup);
 for(let row=0;row<2;row++)for(let col=0;col<3;col++)d.cylinder('Pulsador '+(1+row*3+col),.048,.035,[-.21+col*.21,1.31-row*.18,.15],['green','red','paint-yellow'][col],interfaceGroup,[PI/2,0,0]);
 d.cylinder('Parada de emergencia',.09,.065,[.23,1.02,.17],'red',interfaceGroup,[PI/2,0,0]);
 for(const y of [1.04,1.68])for(const x of [-.29,.29])d.cylinder('Tornillo frontal',.012,.025,[x,y,.145],'steel',interfaceGroup,[PI/2,0,0]);
 d.box('Torre · soporte',[.045,.3,.045],[.24,1.91,0],'steel',housing);
 for(const [i,finish] of ['green','paint-yellow','red'].entries())d.cylinder('Baliza '+finish,.047,.075,[.24,2.01+i*.08,0],finish,housing);
 d.tube('Cableado',[[0,1,0],[0,.5,0],[.25,.2,0]],.018,'dark',housing);
 return d.finish();
}
function flowCell(){
 const d=design('Diagrama espacial · recepción, proceso y expedición'),g=d.group('diagram','Célula de flujo');
 d.box('Placa del diagrama',[3.6,.035,2.2],[0,0,0],'dark',g);
 for(const [i,name] of ['Recepción','Proceso','Control','Expedición'].entries()){const x=-1.25+i*.83;d.round(name,[.6,.1,.65],[x,.09,0],['paint-blue','paint-orange','green','paint-yellow'][i],g,.035);if(i<3){d.tube('Conexión '+name,[[x+.3,.12,0],[x+.53,.12,0]],.025,'steel',g);d.add('cone','Sentido de transferencia',{radius:.07,radiusTop:0,height:.14,segments:16},[x+.52,.12,0],[0,0,-PI/2],'green',g);}}
 d.tube('Retorno de control',[[.41,.11,-.33],[.41,.11,-.75],[-1.25,.11,-.75],[-1.25,.11,-.33]],.018,'steel',g);
 return d.finish({projection:'top'});
}
const factories={robot,forklift,rack,conveyor,pump,controller,'flow-cell':flowCell};
export const TEMPLATES=Object.freeze([
 {id:'robot',name:'Robot industrial',description:'Articulaciones, pinza, manguera y anclajes como piezas independientes.',category:'industrial'},
 {id:'forklift',name:'Montacargas',description:'Mástil, carro, uñas, cabina, ruedas y controles editables.',category:'logistica'},
 {id:'rack',name:'Estantería con pallets',description:'Dos módulos con arriostramientos, apoyos y pallets de entrada real.',category:'logistica'},
 {id:'conveyor',name:'Transportador de rodillos',description:'Bastidor, motor, rodillos, sensores y panel de mando.',category:'industrial'},
 {id:'pump',name:'Bomba en corte',description:'Carcasa transparente, impulsor, conductos y acoplamiento.',category:'industrial'},
 {id:'controller',name:'Panel de control',description:'Armario, pantalla, pulsadores, emergencia y torre de señales.',category:'educacion'},
 {id:'flow-cell',name:'Diagrama de proceso',description:'Diagrama 2D/3D de recepción, proceso, control y expedición.',category:'educacion'}
].map(Object.freeze));
export function createTemplate(id){const factory=factories[id];if(!Object.prototype.hasOwnProperty.call(factories,id)||typeof factory!=='function')throw Error('Anatomy: unknown template.');return factory();}
