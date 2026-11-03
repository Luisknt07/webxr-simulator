import StudioClient from '../studio/StudioClient.js';
import progressSchema from '../../../modules/logistica-industrial/practices/schema/PracticeProgress.cjs';
import sessionSchema from '../../../modules/logistica-industrial/practices/schema/PracticeSession.cjs';
import recipes from '../../../modules/logistica-industrial/practices/configurable/Recipes.cjs';
import routes from '../PlayRoute.cjs';

/** Private DOM/data shell. It never imports a world, renderer, equipment rig or
 * scene document; starting a selected practice is a full document navigation. */
export default class ScenarioLibraryPage {
 constructor({document,window,client=new StudioClient(),loadBrowser=()=>import('../../../modules/logistica-industrial/practices/ui/PracticeBrowser.js'),loadDocumentation=()=>Promise.all([import('../../../packages/documentation/DocumentationBrowser.js'),import('../../../modules/logistica-industrial/practices/configurable/documentation/PracticeBook.cjs')])}){
  this.document=document;this.window=window;this.client=client;this.loadBrowser=loadBrowser;this.loadDocumentation=loadDocumentation;this.generation=0;this.disposed=false;this.progress=null;this.browser=null;
  this.host=document.getElementById('scenario-library-content');this.status=document.getElementById('scenario-library-status');this.account=document.getElementById('scenario-library-account');this.editor=document.querySelector('[data-library-editor]');this.logout=document.getElementById('scenario-library-logout');
  this.client.onSessionChange=()=>this.revoke('La sesión cambió. Inicia sesión para continuar.');
  this.onHide=()=>this.retire();this.onShow=event=>{if(event.persisted){this.disposed=false;this.ready=this.load();}};this.onFocus=()=>this.verifySession().catch(()=>{});this.onLogout=()=>this.signOut();
  window.addEventListener('pagehide',this.onHide);window.addEventListener('pageshow',this.onShow);window.addEventListener('focus',this.onFocus);this.logout.addEventListener('click',this.onLogout);
  this.ready=this.load();
 }
 identity(){return this.client.user&&this.client.user.id||'';}
 current(owner,generation){return!this.disposed&&!!owner&&owner===this.identity()&&generation===this.generation;}
 assert(owner,generation){if(!this.current(owner,generation))throw Error('La cuenta cambió. Vuelve a elegir la práctica.');}
 message(value,error=false){this.status.textContent=value;this.status.setAttribute('data-state',error?'error':'loading');}
 clear(){if(this.browser)this.browser.dispose();this.browser=null;if(this.documentation){this.documentation.dispose();this.documentation=null;}if(this.dialog){this.dialog.remove();this.dialog=null;}this.host.textContent='';this.progress=null;}
 retire(){this.disposed=true;this.generation++;this.clear();this.account.textContent='';this.editor.hidden=true;this.logout.hidden=true;}
 revoke(message){this.retire();this.message(message,true);const login=this.document.createElement('a');login.href='/login?next=%2Fplay';login.textContent=' Iniciar sesión';this.status.appendChild(login);}
 async load(){
  const generation=++this.generation;this.clear();this.message('Cargando tus prácticas…');
  try{
   await this.client.me();if(this.disposed||generation!==this.generation)return false;
   const owner=this.identity();if(!owner){this.revoke('Inicia sesión para consultar tus prácticas.');return false;}
   const result=await this.client.request('GET','/practices/progress');this.assert(owner,generation);this.progress=progressSchema.normalize(result.progress,owner);
   const module=await this.loadBrowser();this.assert(owner,generation);const Browser=module.default||module;
   this.browser=new Browser(this.host,{mode:'campaign',presentation:'page',navigation:'external',identity:()=>this.client.user,progress:this.progress,isAvailable:()=>this.current(owner,generation),availability:(id,mode,settings)=>recipes.availability(id,mode,settings),onStart:(id,settings)=>this.start(id,settings,owner,generation),onDocumentation:target=>this.openDocumentation(target,owner,generation)});
   const loaded=await this.browser.ready;this.assert(owner,generation);if(loaded===false)throw Error('No se pudo cargar el índice de prácticas. Recarga la biblioteca.');this.account.textContent=this.client.user.displayName||this.client.user.username||'Mi cuenta';this.editor.hidden=!(this.client.user.permissions&&this.client.user.permissions.editor);this.logout.hidden=false;this.message('');this.document.documentElement.setAttribute('data-library-state','ready');return true;
  }catch(error){if(!this.disposed&&generation===this.generation){this.clear();this.message(error.message||'No se pudo cargar la biblioteca.',true);this.document.documentElement.setAttribute('data-library-state','error');}return false;}
 }
 async verifySession(){
  if(this.disposed||!this.identity())return false;const owner=this.identity(),generation=this.generation;
  await this.client.me();if(this.disposed||generation!==this.generation)return false;
  if(owner!==this.identity()){this.revoke('La sesión cambió. Recarga la biblioteca de esta cuenta.');return false;}return true;
 }
 async start(id,settings,owner,generation){
  this.assert(owner,generation);if(!await this.verifySession())throw Error('La sesión cambió. Inicia sesión para continuar.');this.assert(owner,generation);
  const canonical=recipes.normalizedOptions(Object.assign({executionMode:'campaign'},settings)),permission=progressSchema.access(this.progress,id,{author:canonical.executionMode==='isolated'});if(!permission.allowed)throw Error(permission.reason);
  const available=recipes.availability(id,canonical.mode,canonical);if(!available.ready&&!available.canConfigure)throw Error(available.reasons.join(' '));
  // No attempt is created here. The execution host rechecks account, progression
  // and configuration before requesting an attempt and constructing the world.
  const url=routes.practiceURL(this.window.location.origin,id,sessionSchema.normalizeAttemptSettings(canonical));this.assert(owner,generation);this.window.location.assign(url);return true;
 }
 async openDocumentation(target,owner,generation){
  this.assert(owner,generation);const [module,data]=await this.loadDocumentation();this.assert(owner,generation);if(this.dialog){this.dialog.close();this.dialog.remove();if(this.documentation)this.documentation.dispose();}
  const dialog=this.document.createElement('dialog');dialog.className='scenario-library-documentation';dialog.setAttribute('aria-label','Documentación de prácticas');const header=this.document.createElement('header'),title=this.document.createElement('strong'),close=this.document.createElement('button'),host=this.document.createElement('div');title.textContent='Guía de prácticas · CEDI y Smart Factory';close.type='button';close.textContent='Volver al catálogo';header.appendChild(title);header.appendChild(close);dialog.appendChild(header);dialog.appendChild(host);this.document.body.appendChild(dialog);this.dialog=dialog;
  const Book=data.default||data,Browser=module.default||module;this.documentation=new Browser(host,{initialTarget:target,getProviders:()=>this.current(owner,generation)?[{id:'sector.logistics-industrial:configurable',moduleId:'sector.logistics-industrial',title:'Prácticas configurables · guía actual',accepts:id=>id.startsWith('smarttwin-configurable-2026:'),load:()=>Book}]:[]});
  const cleanup=()=>{if(this.documentation)this.documentation.dispose();this.documentation=null;dialog.remove();if(this.dialog===dialog)this.dialog=null;};close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',cleanup,{once:true});dialog.showModal();return true;
 }
 async signOut(){if(this.disposed)return;this.logout.disabled=true;try{await this.client.logout();this.retire();this.window.location.assign('/');}catch(error){if(!this.disposed){this.message(error.message,true);this.logout.disabled=false;}}}
 getStats(){return{page:'scenario-library',ready:!this.disposed&&!!this.browser,generation:this.generation,userId:this.identity(),records:this.browser&&this.browser.records.length||0};}
 dispose(){this.retire();this.window.removeEventListener('pagehide',this.onHide);this.window.removeEventListener('pageshow',this.onShow);this.window.removeEventListener('focus',this.onFocus);this.logout.removeEventListener('click',this.onLogout);}
}
