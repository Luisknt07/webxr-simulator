/** Portable authoring data. This module never evaluates source, URLs or HTML. */
export const MODEL_FORMAT = 'smarttwin.anatomy';
export const MODEL_VERSION = 1;
export const MODEL_LIMITS = Object.freeze({parts:96,groups:48,points:64,triangles:60000,segments:48,coordinate:100});
export const DEFAULT_MATERIAL = Object.freeze({color:'#9fb1bd',metalness:.35,roughness:.45,opacity:1});
const fail = message => {throw new Error('Anatomy: '+message);};
const plain = value => value && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const keys = (value,allowed,label) => {if(!plain(value)||Object.keys(Object.getOwnPropertyDescriptors(value)).some(key=>!allowed.includes(key)||Object.getOwnPropertyDescriptor(value,key).get||Object.getOwnPropertyDescriptor(value,key).set))fail(label+' contains unsupported fields.');};
const number = (value,min,max,label) => {if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(label+' is outside its finite range.');return value;};
const text = (value,label,max=160) => {if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f<>]/.test(value))fail(label+' is invalid.');return value;};
const id = (value,label) => {if(typeof value!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value)||['constructor','prototype','__proto__'].includes(value))fail(label+' is invalid.');return value;};
const vector = (value,label,limit=100) => {if(!Array.isArray(value)||value.length!==3)fail(label+' needs XYZ coordinates.');return Array.from(value,(v)=>number(v,-limit,limit,label));};
const clone = value => JSON.parse(JSON.stringify(value));
const field = (key,label,min,max,step=.001,extra={}) => ({key,label,type:'number',min,max,step,...extra});
const dimension = (key,label) => field(key,label,.0001,100);
const segments = field('segments','Segmentos',8,48,1,{integer:true});
const baseBox = {width:.6,height:.4,depth:.4};
// A small closed cube is also a valid starting point for a baked mesh.
const corners=[[-.2,-.2,-.2],[.2,-.2,-.2],[.2,.2,-.2],[-.2,.2,-.2],[-.2,-.2,.2],[.2,-.2,.2],[.2,.2,.2],[-.2,.2,.2]];
const cubeFaces=[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]];
const cubePositions=cubeFaces.flatMap(([a,b,c,d])=>[...corners[a],...corners[b],...corners[c],...corners[a],...corners[c],...corners[d]]);
const definitions = [
 {id:'box',name:'Caja',defaults:baseBox,fields:[dimension('width','Ancho'),dimension('height','Altura'),dimension('depth','Fondo')]},
 {id:'roundedBox',name:'Caja redondeada',defaults:{...baseBox,radius:.04,segments:24},fields:[dimension('width','Ancho'),dimension('height','Altura'),dimension('depth','Fondo'),dimension('radius','Radio de borde'),segments]},
 {id:'cylinder',name:'Cilindro',defaults:{radius:.2,height:.5,segments:24},fields:[dimension('radius','Radio'),dimension('height','Altura'),segments]},
 {id:'cone',name:'Cono / tronco de cono',defaults:{radius:.2,radiusTop:0,height:.5,segments:24},fields:[dimension('radius','Radio inferior'),field('radiusTop','Radio superior',0,100),dimension('height','Altura'),segments]},
 {id:'sphere',name:'Esfera',defaults:{radius:.25,segments:24},fields:[dimension('radius','Radio'),segments]},
 {id:'torus',name:'Toro',defaults:{radius:.25,tubeRadius:.06,segments:24,tubeSegments:12},fields:[dimension('radius','Radio central'),dimension('tubeRadius','Radio del tubo'),segments,field('tubeSegments','Secciones del tubo',6,48,1,{integer:true})]},
 {id:'lathe',name:'Revolución de perfil',defaults:{profile:[[.1,-.3],[.2,-.15],[.18,.2],[.08,.3]],segments:24},fields:[{key:'profile',label:'Perfil [radio, altura]',type:'points2'},segments]},
 {id:'extrude',name:'Perfil extruido',defaults:{profile:[[-.2,-.15],[.2,-.15],[.2,.15],[-.2,.15]],height:.3},fields:[{key:'profile',label:'Perfil [X, Z]',type:'points2'},dimension('height','Altura desde Y = 0')]},
 {id:'tube',name:'Tubo por trayectoria',defaults:{path:[[0,0,0],[0,.3,0],[.2,.5,0]],radius:.025,segments:24},fields:[{key:'path',label:'Trayectoria [X,Y,Z]',type:'points3'},dimension('radius','Radio'),segments]},
 {id:'mesh',name:'Malla de triángulos',defaults:{positions:cubePositions},fields:[{key:'positions',label:'Triángulos XYZ en metros',type:'triangles'}]}
];
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const SHAPE_DEFINITIONS=freeze(definitions);
export const SHAPES=Object.freeze(definitions.map(value=>value.id));
function points(value,size,min,label){if(!Array.isArray(value)||value.length<min||value.length>MODEL_LIMITS.points)fail(label+' needs '+min+'–64 points.');return Array.from(value,row=>{if(!Array.isArray(row)||row.length!==size)fail(label+' has an invalid point.');return Array.from(row,v=>number(v,-100,100,label));});}
export function normalizeParameters(shape,value={}) {
 const spec=definitions.find(item=>item.id===shape);if(!spec)fail('unsupported shape.');
 keys(value,Object.keys(spec.defaults),'Shape parameters');const result=clone(spec.defaults);
 for(const [key,v] of Object.entries(value)){
  const rule=spec.fields.find(item=>item.key===key);
  if(rule.type==='number'){result[key]=number(v,rule.min,rule.max,key);if(rule.integer&&!Number.isInteger(v))fail(key+' needs a whole number.');}
  else if(key==='profile')result[key]=points(v,2,shape==='lathe'?2:3,'Profile');
  else if(key==='path')result.path=points(v,3,2,'Path');
  else {if(!Array.isArray(v)||v.length<9||v.length>MODEL_LIMITS.triangles*9||v.length%9)fail('Mesh needs bounded complete triangles.');result.positions=Array.from(v,n=>number(n,-100,100,'Mesh coordinate'));}
 }
 if(shape==='roundedBox'&&result.radius>Math.min(result.width,result.height,result.depth)/2)fail('Rounded-box radius exceeds half the smallest dimension.');
 if(shape==='torus'&&result.tubeRadius>=result.radius)fail('Torus tube radius must be smaller than its central radius.');
 if(shape==='lathe'){
  if(!result.profile.some(row=>row[0]>0)||result.profile.some((row,index)=>row[0]<0||index>0&&row[1]<=result.profile[index-1][1]||index>0&&index<result.profile.length-1&&row[0]===0))fail('Lathe radii must be nonnegative and heights strictly increasing.');
 }
 if(shape==='tube')for(let i=1;i<result.path.length;i++)if(Math.hypot(...result.path[i].map((n,j)=>n-result.path[i-1][j]))<1e-8)fail('Tube path repeats consecutive points.');
 return result;
}
function material(value={}){keys(value,Object.keys(DEFAULT_MATERIAL),'Material');const out={...DEFAULT_MATERIAL,...value};if(typeof out.color!=='string'||!/^#[a-f0-9]{6}$/i.test(out.color))fail('Material color must be a hex RGB color.');out.color=out.color.toLowerCase();for(const key of ['metalness','roughness','opacity'])out[key]=number(out[key],0,1,key);return out;}
export function createPart(shape='box',options={}){
 keys(options,['id','name','parameters','position','rotation','material','visible','explode','groupId'],'Part options');
 return normalizePart({id:options.id===undefined?'part-1':options.id,name:options.name===undefined?(definitions.find(item=>item.id===shape)||{}).name:options.name,shape,...options});
}
function normalizePart(value){
 keys(value,['id','name','shape','parameters','position','rotation','material','visible','explode','groupId'],'Part');
 if(!SHAPES.includes(value.shape))fail('Part shape is unsupported.');
 const out={id:id(value.id,'Part ID'),name:text(value.name,'Part name'),shape:value.shape,parameters:normalizeParameters(value.shape,value.parameters===undefined?{}:value.parameters),position:vector(value.position===undefined?[0,0,0]:value.position,'Part position'),rotation:vector(value.rotation===undefined?[0,0,0]:value.rotation,'Part rotation'),material:material(value.material===undefined?{}:value.material),visible:value.visible===undefined?true:value.visible,explode:vector(value.explode===undefined?[0,0,0]:value.explode,'Exploded offset')};
 if(typeof out.visible!=='boolean')fail('Part visibility must be boolean.');if(value.groupId!==undefined)out.groupId=id(value.groupId,'Part group ID');return out;
}
function normalizeGroup(value){
 keys(value,['id','name','parentId','motion'],'Group');const out={id:id(value.id,'Group ID'),name:text(value.name,'Group name')};if(value.parentId!==undefined)out.parentId=id(value.parentId,'Parent group ID');
 if(value.motion!==undefined){const m=value.motion;keys(m,['type','axis','pivot','min','max','value'],'Group motion');if(!['fixed','hinge','slide'].includes(m.type))fail('Unsupported group motion.');const axis=vector(m.axis===undefined?[0,1,0]:m.axis,'Motion axis',1);const length=Math.hypot(...axis);if(Math.abs(length-1)>.0001)fail('Motion axis must be unit length.');const min=number(m.min===undefined?0:m.min,-100,100,'Motion minimum'),max=number(m.max===undefined?0:m.max,-100,100,'Motion maximum');if(min>max)fail('Motion limits are reversed.');out.motion={type:m.type,axis:axis.map(n=>n/length),pivot:vector(m.pivot===undefined?[0,0,0]:m.pivot,'Motion pivot'),min,max,value:number(m.value===undefined?min:m.value,min,max,'Motion value')};}
 return out;
}
export function normalizeModel(value){
 keys(value,['format','version','units','name','parts','groups','view'],'Document');
 if(value.format!==undefined&&value.format!==MODEL_FORMAT||value.version!==undefined&&value.version!==1||value.units!==undefined&&value.units!=='m')fail('Unsupported document format, version or units.');
 if(!Array.isArray(value.parts)||!value.parts.length||value.parts.length>MODEL_LIMITS.parts)fail('A model needs 1–96 parts.');
 const parts=[],ids=new Set();let meshTriangles=0;
 for(const candidate of value.parts){const part=normalizePart(candidate);if(ids.has(part.id))fail('Duplicate part ID.');ids.add(part.id);if(part.shape==='mesh')meshTriangles+=part.parameters.positions.length/9;if(meshTriangles>MODEL_LIMITS.triangles)fail('The complete model exceeds 60000 imported triangles.');parts.push(part);}
 const groups=value.groups===undefined?[]:value.groups;if(!Array.isArray(groups)||groups.length>MODEL_LIMITS.groups)fail('Too many groups.');
 const normalizedGroups=Array.from(groups,normalizeGroup),byId=new Map();for(const group of normalizedGroups){if(byId.has(group.id))fail('Duplicate group ID.');byId.set(group.id,group);}
 for(const group of normalizedGroups){const seen=new Set([group.id]);let current=group;while(current.parentId){if(!byId.has(current.parentId)||seen.has(current.parentId)||seen.size>=16)fail('Group hierarchy is missing, cyclic or too deep.');seen.add(current.parentId);current=byId.get(current.parentId);}}
 if(parts.some(part=>part.groupId&&!byId.has(part.groupId)))fail('Part refers to a missing group.');
 const view=value.view===undefined?{}:value.view;keys(view,['theme','mode','projection','explode'],'View');const normalizedView={theme:view.theme===undefined?'dark':view.theme,mode:view.mode===undefined?'solid':view.mode,projection:view.projection===undefined?'isometric':view.projection,explode:view.explode===undefined?0:number(view.explode,0,1,'Exploded view')};
 if(!['dark','light'].includes(normalizedView.theme)||!['solid','transparent','wireframe'].includes(normalizedView.mode)||!['isometric','front','side','top'].includes(normalizedView.projection))fail('Unsupported view.');
 return {format:MODEL_FORMAT,version:1,units:'m',name:text(value.name===undefined?'Diseño paramétrico':value.name,'Model name'),parts,groups:normalizedGroups,view:normalizedView};
}
