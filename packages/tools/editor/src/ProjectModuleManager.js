import {createLocalCatalog,createProjectSession} from '../../../core/index.js';
import {cloneData} from '../../../contracts/index.js';
import profileSchema from '../../../project-model/shared/project-module-profile.js';
import {renderPanel} from '../../../../apps/project-viewer/models.mjs';

const {normalizeModuleProfile,enabledModules}=profileSchema;
const canonical=value=>JSON.stringify(value,(key,item)=>{if(item&&typeof item==='object'&&!Array.isArray(item)){const result=Object.create(null);for(const name of Object.keys(item).sort())result[name]=item[name];return result;}return item;});
const equal=(left,right)=>canonical(left)===canonical(right);
const hash=value=>{let result=2166136261;for(const letter of String(value)){result^=letter.charCodeAt(0);result=Math.imul(result,16777619);}return (result>>>0).toString(16);};

/** Adds portable functions beside the legacy editor without claiming that its
 * physical industrial world can be unloaded as a portable sector. */
export default class ProjectModuleManager {
  constructor(editor,options={}){
    this.editor=editor;this.options=options;this.catalog=options.catalog&&typeof options.catalog.plan==='function'?options.catalog:createLocalCatalog(options.catalog||[]);
    this.document=options.document||(typeof document==='undefined'?null:document);this.profile=normalizeModuleProfile();this.viewer=false;this.hasProfile=false;
    this.viewerSelection='';this.editorSelection='';this.contextStates=new Map();this.queue=Promise.resolve();this.ready=Promise.resolve();this.pending=0;this.disposed=false;this.listeners=[];
  }
  get busy(){return this.pending>0||!!(this.session&&this.session.busy);}
  get activeModuleId(){return this.profile.mode==='specialized'?this.profile.selectedModuleId:this.viewer?this.viewerSelection:this.editorSelection;}
  _identity(){const editor=this.editor,client=editor.ctx&&editor.ctx.studio&&editor.ctx.studio.client,user=client&&client.user&&client.user.id||editor.accessView&&editor.accessView.user&&editor.accessView.user.id||'';return String(editor.currentProject&&editor.currentProject.id||'local')+'@'+String(editor.projectGeneration||0)+'#'+String(editor.accessView&&editor.accessView.identityGeneration||0)+'/'+String(user);}
  _raw(){return this.editor.document&&this.editor.document.studio&&this.editor.document.studio.moduleProfile;}
  _runtimeProfileCurrent(){const raw=this._raw();if(raw===this.runtimeRaw)return true;try{return equal(normalizeModuleProfile(raw),normalizeModuleProfile(this.runtimeRaw));}catch(_){return false;}}
  _canAuthor(){return !!(this.editor.active&&this.editor.canEditDocument&&this.editor.canEditDocument());}
  _notify(error){if(this.editor.toast)this.editor.toast(error&&error.message||String(error));}
  _enqueue(task){
    this.pending++;const pending=this.queue.then(task);this.queue=pending.catch(()=>{});
    const result=pending.then(value=>{this.pending--;this._draw();return value;},error=>{this.pending--;this._draw();throw error;});
    result.catch(error=>this._notify(error));this.ready=result;return result;
  }
  _state(){try{const snapshot=this.session&&this.session.capture();return snapshot&&snapshot.state||null;}catch(_){return null;}}
  _saveContext(){const state=this._state();if(state&&this.runtimeContext)this.contextStates.set(this.runtimeContext,state);}
  _project(profile,viewer,selection){
    const enabled=new Set(enabledModules(profile,{viewer,moduleId:selection}).map(row=>row.id));
    const id=String(this.editor.currentProject&&this.editor.currentProject.id||'local');
    const content=profile.project?cloneData(profile.project):{};
    return {...content,format:'smarttwin.project',version:1,id:content.id||'workspace.'+id,worldId:profile.worldId||profile.state&&profile.state.worldId||'world.workspace.'+(id.length<=150?id:hash(id)),modules:profile.modules.map(row=>({id:row.id,version:row.version,enabled:enabled.has(row.id),...(row.optional===undefined?{}:{optional:row.optional}),...(row.functions===undefined?{}:{functions:row.functions})})),entities:content.entities||[]};
  }
  _session(){if(!this.session)this.session=createProjectSession({catalog:this.catalog,defaultFunctions:this.options.defaultFunctions||{},ports:this.options.ports||{},grants:this.options.grants||[]});return this.session;}
  sync({viewer=!this.editor.active}={}){
    if(this.disposed)return Promise.resolve(false);
    viewer=viewer||!this._canAuthor();
    const identity=this._identity(),raw=this._raw(),selection=viewer?this.viewerSelection:this.editorSelection;
    const sameContext=this.wanted&&this.wanted.identity===identity&&this.wanted.viewer===viewer&&this.wanted.selection===selection;
    if(sameContext&&this.wanted.raw===raw)return this.ready;
    let profile;try{profile=normalizeModuleProfile(raw);}catch(error){this._notify(error);return Promise.reject(error);}
    // Studio normalizes its entire document on unrelated level/resource edits.
    // A fresh object with the same authored profile must not reload live state.
    // Keep an in-flight request's identity: only its equivalent raw reference
    // changes, and its late completion must adopt that latest reference.
    if(sameContext&&equal(this.wanted.profile,profile)){
      const previous=this.wanted.raw;this.wanted.raw=raw;this.wanted.profile=profile;this.profile=profile;this.hasProfile=raw!==undefined&&raw!==null;
      if(this.runtimeIdentity===identity&&this.runtimeRaw===previous)this.runtimeRaw=raw;
      return this.ready;
    }
    const request={identity,raw,viewer,selection,profile};this.wanted=request;this.profile=profile;this.viewer=viewer;this.hasProfile=raw!==undefined&&raw!==null;
    return this._enqueue(async()=>{
      if(this.disposed||this.wanted!==request)return false;
      this._saveContext();const context=identity+'|'+(viewer?'viewer':'editor');
      const useCached=this.runtimeIdentity===identity&&(this.runtimeRaw===request.raw||equal(normalizeModuleProfile(this.runtimeRaw),profile));
      const state=useCached&&this.contextStates.has(context)?this.contextStates.get(context):profile.state||(useCached?this.contextStates.get(identity+'|editor'):null)||null;
      await this._session().open(this._project(profile,viewer,selection),{state,allowOptionalMissing:true});
      this.runtimeContext=context;this.runtimeIdentity=identity;this.runtimeRaw=request.raw;this.runtimeViewer=viewer;
      return this.wanted===request;
    });
  }
  availableModules(){return this.catalog.modules().map(module=>({id:module.id,version:module.version,title:module.metadata.title||module.metadata.folder||module.id,functions:module.functions.map(entry=>({id:entry.id,title:entry.metadata&&entry.metadata.title||entry.id}))}));}
  canShowLevel(moduleId){
    if(!moduleId||!this.hasProfile)return true;
    const row=this.profile.modules.find(module=>module.id===moduleId);if(!row||!row[this.viewer?'viewerEnabled':'editorEnabled'])return false;
    return !this.activeModuleId||moduleId===this.activeModuleId;
  }
  _refreshLevels(){if(this.editor.studioTools&&this.editor.studioTools.refreshLabels)this.editor.studioTools.refreshLabels();if(this.options.onFilterChanged)this.options.onFilterChanged(this.activeModuleId);}
  _write(profile){
    const next=normalizeModuleProfile(profile);if(equal(this._raw(),next))return false;
    this.editor.document.setStudio({moduleProfile:next});this.profile=next;this.hasProfile=true;this.runtimeRaw=this._raw();
    if(this.wanted){this.wanted.raw=this.runtimeRaw;this.wanted.profile=next;}this._refreshLevels();return true;
  }
  async setProfile(update){
    if(!this._canAuthor())throw Error('Abre el proyecto en modo edición para configurar sus módulos.');await this.sync({viewer:false});
    return this._enqueue(async()=>{
      if(this.disposed||!this._canAuthor())throw Error('Tu cuenta ya no puede editar este proyecto.');
      const identity=this._identity(),raw=this._raw(),base=normalizeModuleProfile(raw),next=normalizeModuleProfile(typeof update==='function'?update(cloneData(base)):{...base,...cloneData(update)});
      this._saveContext();const state=this._state()||base.state||null;
      await this._session().open(this._project(next,false,''),{state,allowOptionalMissing:true});
      let unchanged=this._raw()===raw;try{if(!unchanged)unchanged=equal(normalizeModuleProfile(this._raw()),base);}catch(_){unchanged=false;}
      if(this._identity()!==identity||!unchanged||!this._canAuthor()){
        try{await this.session.dispose({force:true});}finally{this.session=null;this.wanted=null;this.runtimeContext=null;this.runtimeRaw=null;}
        throw Error('El proyecto o sus permisos cambiaron. Vuelve a abrir Módulos.');
      }
      const snapshot=this.session.capture();next.state=snapshot.state;next.worldId=snapshot.state.worldId;this.runtimeIdentity=identity;this.runtimeContext=identity+'|editor';this.runtimeViewer=false;
      this._write(next);this.contextStates.set(this.runtimeContext,snapshot.state);this.profile=normalizeModuleProfile(this._raw());this.viewer=false;this.viewerSelection='';this.editorSelection='';
      this.wanted={identity,raw:this._raw(),viewer:false,selection:'',profile:this.profile};return this.profile;
    });
  }
  enableModule(moduleId,{functions}={}){const installed=this.catalog.getModule(moduleId);if(!installed)return Promise.reject(Error('El módulo no está instalado en esta distribución.'));
    return this.setProfile(profile=>{let row=profile.modules.find(entry=>entry.id===moduleId);if(!row){row={id:moduleId,version:installed.version,editorEnabled:true,viewerEnabled:true};profile.modules.push(row);}row.editorEnabled=true;if(functions!==undefined)row.functions=cloneData(functions);return profile;});}
  setModuleEnabled(moduleId,{editorEnabled,viewerEnabled}={}){return this.setProfile(profile=>{const row=profile.modules.find(entry=>entry.id===moduleId);if(!row)throw Error('El módulo no pertenece al proyecto.');if(editorEnabled!==undefined)row.editorEnabled=editorEnabled;if(viewerEnabled!==undefined)row.viewerEnabled=viewerEnabled;return profile;});}
  removeModule(moduleId){return this.setProfile(profile=>{profile.modules=profile.modules.filter(row=>row.id!==moduleId);if(profile.selectedModuleId===moduleId){profile.selectedModuleId='';profile.mode='mixed';}return profile;});}
  async selectModule(moduleId=''){
    await this.sync({viewer:!this.editor.active});const available=enabledModules(this.profile,{viewer:this.viewer});
    if(moduleId&&!available.some(row=>row.id===moduleId))throw Error('Este módulo no está disponible para esta vista.');
    if(this.viewer)this.viewerSelection=moduleId;else this.editorSelection=moduleId;
    await this.sync({viewer:this.viewer});this._refreshLevels();this._draw();return this.activeModuleId;
  }
  async dispatch(key,payload){
    if(this.disposed||this.busy||!this.session)throw Error('Espera a que termine de cambiar el contexto del proyecto.');
    if(this.runtimeIdentity!==this._identity()||!this._runtimeProfileCurrent())throw Error('La configuración del proyecto cambió. Espera a que se actualice su contexto.');
    const session=this.session,identity=this._identity(),result=await session.dispatch(key,payload);
    if(!this.disposed&&this.session===session&&this._identity()===identity&&this._canAuthor()&&!this.viewer)this.flush();
    return result;
  }
  flush(){
    if(this.disposed||this.busy||!this._canAuthor()||this.runtimeViewer||this.runtimeIdentity!==this._identity())return false;
    if(!this._runtimeProfileCurrent())return false;
    const state=this._state();if(!state||!this.hasProfile&&!this.profile.modules.length&&!state.functions.length)return false;
    const profile={...normalizeModuleProfile(this._raw()),state,worldId:state.worldId};return this._write(profile);
  }
  step(delta){if(!this.disposed&&!this.pending&&this.session)this.session.step(delta);}
  async open({viewer=!this.editor.active}={}){await this.sync({viewer});if(this.disposed||!this.document)return false;if(!this.dialog){this.dialog=this.document.createElement('dialog');this.dialog.className='ed-project-modules';this.dialog.setAttribute('aria-label','Módulos del proyecto');this.dialog.style.cssText='width:min(900px,92vw);max-height:84vh;overflow:auto;background:#142b35;color:#eaf5f1;border:1px solid #6caaa1;border-radius:14px;padding:22px;';this.document.body.appendChild(this.dialog);const close=event=>{event.preventDefault();this.close();};this.dialog.addEventListener('cancel',close);this.listeners.push(()=>this.dialog.removeEventListener('cancel',close));}this._draw();if(this.dialog.showModal&&!this.dialog.open)this.dialog.showModal();else this.dialog.setAttribute('open','');return true;}
  close(){if(this.dialog){if(this.dialog.close)this.dialog.close();else this.dialog.removeAttribute('open');}this._clearPanel();}
  _clearPanel(){const pending=this.panelCleanup||[];this.panelCleanup=[];const errors=[];for(const off of pending)try{off();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'No se pudo cerrar toda la interfaz de módulos.');}
  _draw(){
    if(!this.dialog||this.disposed)return;this._clearPanel();this.panelCleanup=[];this.dialog.textContent='';const doc=this.document;
    const add=(tag,text,parent=this.dialog)=>{const node=doc.createElement(tag);node.textContent=text;parent.appendChild(node);return node;};
    const button=(label,action,parent=this.dialog,disabled=false)=>{const node=add('button',label,parent);node.type='button';node.disabled=this.busy||disabled;const handler=()=>Promise.resolve().then(action).catch(error=>this._notify(error));node.addEventListener('click',handler);this.panelCleanup.push(()=>node.removeEventListener('click',handler));return node;};
    add('h2','Módulos del proyecto');button('Cerrar',()=>this.close());add('p',this.viewer?'Elige entre los módulos disponibles para esta experiencia.':'Configura qué módulos se editan y cuáles se ofrecen al visitante.');
    const available=enabledModules(this.profile,{viewer:this.viewer}),label=add('label','Vista de niveles: '),select=doc.createElement('select');label.appendChild(select);
    for(const row of [{id:'',title:'Todos los disponibles'},...available.map(row=>{const module=this.availableModules().find(module=>module.id===row.id);return {id:row.id,title:module&&module.title||row.id};})]){const option=add('option',row.title,select);option.value=row.id;}select.value=this.activeModuleId;select.disabled=this.busy||this.profile.mode==='specialized';
    const changed=()=>this.selectModule(select.value).catch(error=>this._notify(error));select.addEventListener('change',changed);this.panelCleanup.push(()=>select.removeEventListener('change',changed));
    if(!this.viewer&&this._canAuthor()){
      const modeLabel=add('label',' Tipo de proyecto: '),mode=doc.createElement('select');modeLabel.appendChild(mode);for(const [value,title] of [['mixed','Varios módulos'],['specialized','Un módulo especializado']]){const option=add('option',title,mode);option.value=value;}mode.value=this.profile.mode;mode.disabled=this.busy;
      const modeChange=()=>this.setProfile(profile=>({...profile,mode:mode.value,selectedModuleId:mode.value==='specialized'?profile.selectedModuleId||profile.modules[0]&&profile.modules[0].id||'':profile.selectedModuleId})).catch(error=>this._notify(error));mode.addEventListener('change',modeChange);this.panelCleanup.push(()=>mode.removeEventListener('change',modeChange));
      for(const module of this.availableModules()){
        const row=this.profile.modules.find(entry=>entry.id===module.id),card=add('section','');card.style.cssText='padding:14px;margin:12px 0;border:1px solid #6caaa155;border-radius:10px;';add('h3',module.title,card);add('small',module.id,card);
        if(!row)button('Añadir al proyecto',()=>this.enableModule(module.id),card);else{
          for(const [field,title] of [['editorEnabled','Disponible para editar'],['viewerEnabled','Disponible al visitante']]){const flag=add('label','',card);flag.style.display='block';const input=doc.createElement('input');input.type='checkbox';input.checked=row[field];input.disabled=this.busy;flag.appendChild(input);add('span',title,flag);const action=()=>this.setModuleEnabled(module.id,{[field]:input.checked}).catch(error=>this._notify(error));input.addEventListener('change',action);this.panelCleanup.push(()=>input.removeEventListener('change',action));}
          if(this.profile.mode==='specialized')button(this.profile.selectedModuleId===module.id?'Módulo especializado actual':'Especializar en este módulo',()=>this.setProfile({selectedModuleId:module.id}),card,this.profile.selectedModuleId===module.id);
          button('Quitar del proyecto',()=>this.removeModule(module.id),card);
        }
      }
      for(const row of this.profile.modules.filter(entry=>!this.catalog.getModule(entry.id))){add('p',row.id+' · paquete no incluido; sus datos se conservan.');button('Quitar referencia',()=>this.removeModule(row.id));}
    }
    if(!this.profile.modules.length)add('p',this.viewer?'Este proyecto utiliza su experiencia principal.':'No hay funciones adicionales seleccionadas. Los contenidos y niveles existentes se conservan.');
    if(this.session&&this.session.host&&!this.busy){const host=this.session.host,active=new Set(host.status().functions.filter(row=>row.status==='active').map(row=>row.id));const panels=add('div','');for(const registration of host.registry('ui').filter(row=>active.has(row.functionId)))this.panelCleanup.push(renderPanel({document:doc,parent:panels,registration,commands:host.registry('commands'),project:this.session.project,dispatch:(key,payload)=>this.dispatch(key,payload),isCurrent:()=>!this.disposed&&!this.busy&&!!this.dialog&&this.dialog.open!==false}));}
    add('p','Los paquetes nuevos se instalan localmente, se revisan y se incorporan al compilar. Un archivo de proyecto no ejecuta código externo.');
  }
  async dispose(){if(this.disposed)return;this.disposed=true;const errors=[];try{this.close();}catch(error){errors.push(error);}for(const off of this.listeners.splice(0))try{off();}catch(error){errors.push(error);}try{if(this.session)await this.session.dispose({force:true});}catch(error){errors.push(error);}await this.queue.catch(()=>{});try{if(this.dialog)this.dialog.remove();}catch(error){errors.push(error);}this.contextStates.clear();if(errors.length)throw new AggregateError(errors,'No se pudo liberar todo el gestor de módulos.');}
}
