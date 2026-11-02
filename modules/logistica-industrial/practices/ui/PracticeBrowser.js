import progressSchema from '../schema/PracticeProgress.cjs';
import PracticeSetupForm from './PracticeSetupForm.js';
let nextBrowserId=0;
const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;};
const optionsFor=(select,items)=>items.forEach(item=>{const option=node('option','',item.label);option.value=item.value;select.appendChild(option);});
const failureText=error=>error&&error.message||'No se pudo completar la acción.';

/** Source-based catalogue. Creation and every real action remain in the host. */
export default class PracticeBrowser{
 constructor(host,options={}){
  if(!host||!host.appendChild)throw Error('Falta el contenedor de prácticas.');
  this.options=options;this.campaignMode=options.mode==='campaign';this.disposed=false;this.busy=false;this.records=[];this.settings=new Map();this.id='st-practices-'+(++nextBrowserId);this.root=node('section','st-practice-browser');this.root.setAttribute('data-practice-mode',this.campaignMode?'campaign':'author');host.appendChild(this.root);
  const header=node('div','st-practice-browser-head');this.root.appendChild(header);const heading=node('div');header.appendChild(heading);heading.appendChild(node('p','st-practice-eyebrow','SMART-TWIN · APRENDER HACIENDO'));heading.appendChild(node('h2','', 'Elegir práctica'));
  const close=node('button','st-practice-close','Cerrar ×');close.type='button';close.addEventListener('click',()=>{if(this.disposed)return;if(options.onClose)options.onClose();});header.appendChild(close);
  this.root.appendChild(node('p','st-practice-intro',this.campaignMode?'Aprende haciendo. Supera cada operación con evidencia real para desbloquear la siguiente; basta una modalidad aprobada. Tu progreso se conserva en tu cuenta.':'Elige una operación y revisa sus recursos, pasos y condiciones. Cada configuración se comprueba con las capacidades reales antes de crear el escenario.'));
  if(this.campaignMode){const routes=node('nav','st-practice-route-picker');routes.setAttribute('aria-label','Rutas de aprendizaje');for(const route of progressSchema.ROUTES){const button=node('button','st-practice-route',route.title);button.type='button';button.setAttribute('data-practice-route',route.id);button.addEventListener('click',()=>{this.domain.value=route.domain;this.render();});routes.appendChild(button);}this.root.appendChild(routes);}
  const filters=node('div','st-practice-filters');this.root.appendChild(filters);const searchLabel=node('label','','Buscar operación');this.search=node('input');this.search.type='search';this.search.placeholder='Código, operación o tarea…';searchLabel.appendChild(this.search);filters.appendChild(searchLabel);
  const domainLabel=node('label','','Área');this.domain=node('select');optionsFor(this.domain,[{value:'all',label:'Todas las operaciones'},{value:'logistics',label:'CEDI · Logística'},{value:'industrial',label:'Smart Factory · Industrial'}]);domainLabel.appendChild(this.domain);filters.appendChild(domainLabel);if(options.routeId){const route=progressSchema.ROUTES.find(row=>row.id===options.routeId);if(route)this.domain.value=route.domain;}
  this.count=node('p','st-practice-count','Cargando índice…');this.root.appendChild(this.count);this.status=node('p','st-practice-status');this.status.setAttribute('role','status');this.root.appendChild(this.status);this.list=node('div','st-practice-list');this.root.appendChild(this.list);
  this.search.addEventListener('input',()=>this.render());this.domain.addEventListener('change',()=>this.render());
  const loader=options.loadIndex||(()=>import('../configurable/index.cjs')),capLoader=options.loadCapabilities||(()=>import('../configurable/Recipes.cjs'));
  this.ready=Promise.resolve().then(()=>Promise.all([loader(),capLoader()])).then(([value,capabilities])=>{if(this.disposed)return false;const data=value&&value.default||value;this.capabilities=capabilities&&capabilities.default||capabilities;this.index=data;this.records=data.entries||[];this.render();return true;}).catch(error=>{if(!this.disposed)this.status.textContent=failureText(error);return false;});
 }
 available(){return!this.disposed&&(!this.options.isAvailable||this.options.isAvailable()===true);}
 capability(record,mode,settings={}){try{if(typeof this.options.availability==='function')return this.options.availability(record.id,mode,settings);if(!this.capabilities||typeof this.capabilities.availability!=='function')throw Error('No se pudo comprobar la disponibilidad de esta modalidad.');return this.capabilities.availability(record.id,mode,settings);}catch(error){return{ready:false,reasons:[failureText(error)]};}}
 campaignAccess(record,settings){if(!this.campaignMode||settings&&settings.executionMode==='isolated')return{allowed:true,completed:false};try{const identity=typeof this.options.identity==='function'?this.options.identity():this.options.identity,userId=identity&&identity.id||identity&&identity.userId||this.options.userId,stored=typeof this.options.progress==='function'?this.options.progress():this.options.progress,progress=progressSchema.normalize(stored&&stored.progress||stored,userId);return progressSchema.access(progress,record.id);}catch(error){return{allowed:false,locked:true,reason:'Inicia sesión y carga el progreso de esta cuenta para continuar.'};}}
 validation(record){const rows=typeof this.options.validationList==='function'?this.options.validationList():this.options.validationList;if(!rows)return null;if(rows instanceof Map)return rows.get(record.key)||rows.get(record.id)||null;if(Array.isArray(rows))return rows.find(row=>row.id===record.id||row.practiceId===record.id||row.key===record.key)||null;return rows[record.key]||rows[record.id]||null;}
 render(){
  if(this.disposed)return;if(this.activeSetup){this.activeSetup.dispose();this.activeSetup=null;}this.list.textContent='';const query=this.search.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),domain=this.domain.value;
  const rows=this.records.filter(record=>{const words=[record.id,record.title,(typeof record.objective==='string'?record.objective:record.objective&&record.objective.text)].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();return(domain==='all'||record.domain===domain)&&query.split(/\s+/).every(term=>words.includes(term));});
  this.count.textContent=rows.length+' de '+this.records.length+' prácticas · 5 CEDI y 5 Smart Factory · 6 misiones por práctica';
  if(!this.available())this.status.textContent='Esta biblioteca no está disponible en el contexto actual.';else if(!this.busy)this.status.textContent=this.campaignMode?'Las operaciones bloqueadas muestran su requisito. Puedes consultar su guía antes de desbloquearlas.':'Selecciona una ficha para configurar el intento. Las ilustraciones se cargan al abrirla.';
  for(const group of [['logistics','CEDI · Logística'],['industrial','Smart Factory · Industrial']]){const members=rows.filter(row=>row.domain===group[0]);if(!members.length)continue;const section=node('section','st-practice-domain');section.appendChild(node('h3','',group[1]+' · '+members.length));const grid=node('div','st-practice-grid');section.appendChild(grid);this.list.appendChild(section);for(const record of members)grid.appendChild(this.card(record));}
  if(!rows.length)this.list.appendChild(node('p','st-practice-empty','No hay operaciones que coincidan con la búsqueda.'));
 }
 card(record){
  const details=node('details','st-practice-card'),summary=node('summary','st-practice-summary');summary.appendChild(node('span','st-practice-code',record.id));summary.appendChild(node('strong','',record.title));summary.appendChild(node('span','st-practice-card-goal',(typeof record.objective==='string'?record.objective:record.objective&&record.objective.text)||''));const validation=this.validation(record),access=this.campaignAccess(record),label=this.campaignMode?(access.completed?'Superada · '+access.bestScore+' / 100':access.allowed?'Disponible para jugar':'Bloqueada · '+(access.prerequisite||'Inicia sesión')):validation&&(validation.ready===true||validation.passed===true)?'Configuración comprobada':validation&&(validation.ready===false||validation.passed===false)?'Requiere capacidades pendientes':'Se valida al crear';details.setAttribute('data-locked',String(!access.allowed));summary.appendChild(node('span','st-practice-validation',label));details.appendChild(summary);
  details.addEventListener('toggle',()=>{if(details.open&&!details.querySelector('.st-practice-card-body')&&!this.disposed)this.details(record,details,validation);});return details;
 }
 field(parent,label,control){const wrapper=node('label','st-practice-field',label);wrapper.appendChild(control);parent.appendChild(wrapper);return control;}
 details(record,parent,validation){
  if(this.openCard&&this.openCard!==parent)this.openCard.open=false;this.openCard=parent;
  const body=node('div','st-practice-card-body');parent.appendChild(body);const initial=this.settings.get(record.key)||{executionMode:this.campaignMode?'campaign':'isolated'};
  let definition=record;if(this.capabilities&&typeof this.capabilities.entry==='function'){try{definition=this.capabilities.entry(record.id);}catch(error){this.status.textContent=failureText(error);}}
  const setup=new PracticeSetupForm(body,{record:Object.assign({},record,definition),definition,index:this.index,settings:initial,
   plan:settings=>this.capabilities.plan(record.id,settings),capability:(mode,settings)=>{const cap=this.capability(record,mode,settings),currentValidation=this.validation(record);if(currentValidation&&(currentValidation.ready===false||currentValidation.passed===false))return{ready:false,reasons:currentValidation.errors||currentValidation.reasons||["La configuración requiere capacidades pendientes."]};return cap;},
   access:settings=>this.campaignAccess(record,settings),onChange:settings=>this.settings.set(record.key,settings),
   onDocumentation:target=>this.options.onDocumentation&&this.options.onDocumentation(target),
   onStart:async settings=>{const callback=this.campaignMode?this.options.onStart||this.options.onCreate:this.options.onCreate;if(!this.available()||this.busy||!callback)return;const permission=this.campaignAccess(record,settings);if(!permission.allowed)throw Error(permission.reason);this.busy=true;this.status.textContent="Validando los activos del escenario…";try{return await callback(record.id,settings);}finally{this.busy=false;}}
  });
  this.activeSetup=setup;const close=()=>{if(!parent.open){setup.dispose();if(this.activeSetup===setup)this.activeSetup=null;if(body.parentNode)body.remove();parent.removeEventListener('toggle',close);}};parent.addEventListener('toggle',close);
 }
 refresh(){if(!this.disposed)this.render();}
 setProgress(value,userId){if(this.disposed)return;this.options.progress=value;this.options.userId=userId;this.render();}
 dispose(){if(this.disposed)return;this.disposed=true;if(this.activeSetup)this.activeSetup.dispose();this.activeSetup=null;this.settings.clear();this.records=[];this.root.remove();}
}
