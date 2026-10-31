const element=(tag,text,parent,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;if(parent)parent.appendChild(node);return node;};
const button=(text,parent,action,disabled=false)=>{const node=element('button',text,parent,'ed-button');node.type='button';node.disabled=disabled;node.addEventListener('click',action);return node;};

/** Project content and levels, independent of engine folders. Server paths are
 * authorized metadata; local paths are only directory handles chosen by user. */
export default class ProjectContentBrowser {
  constructor(editor){this.editor=editor;this.category='Maps';this.busy=false;}
  current(){return !!this.dialog&&this.editor.projectGeneration===this.generation;}
  open(){
    if(this.dialog){this.dialog.focus();return;}
    const editor=this.editor;editor.clearNavigation();this.generation=editor.projectGeneration;this.previousFocus=document.activeElement;
    const dialog=element('dialog',undefined,editor.ui,'ed-content-browser');this.dialog=dialog;dialog.setAttribute('aria-label','Contenido del proyecto');
    const header=element('header',undefined,dialog,'ed-content-header'),heading=element('div',undefined,header);element('h2','Contenido del proyecto',heading);element('p',editor.projectName,heading);
    this.closeButton=button('Cerrar',header,()=>this.close());this.location=element('div',undefined,dialog,'ed-content-location');
    const actions=element('div',undefined,dialog,'ed-content-actions');
    button('Guardar proyecto',actions,()=>this.run(()=>editor.saveProject()),!editor.canEditDocument());
    button('Descargar proyecto independiente',actions,()=>this.run(()=>editor.exportContentProject()));
    button('Guardar carpeta local…',actions,()=>this.run(()=>editor.exportContentFolder()));
    button('Abrir carpeta de proyecto…',actions,()=>this.run(async()=>{this.close(true);await editor.openContentFolder();}));
    button('Importar proyecto…',actions,()=>{if(!this.current())return;this.close();editor.projectInput.click();});
    button('Módulos del proyecto…',actions,()=>{if(!this.current())return;this.close();if(editor.projectModules)editor.projectModules.open();else editor.toast('Los módulos se están preparando.');});
    const body=element('div',undefined,dialog,'ed-content-body'),tree=element('nav',undefined,body,'ed-content-tree');tree.setAttribute('aria-label','Carpetas del proyecto');
    element('strong','Content',tree);for(const folder of ['Maps','Assets','Config'])button(folder==='Config'?'Config':folder,tree,()=>{this.category=folder;this.render();});
    this.list=element('div',undefined,body,'ed-content-list');this.feedback=element('p','',dialog,'ed-content-feedback');this.feedback.setAttribute('role','status');
    dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
    dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.code==='Escape'){event.preventDefault();this.close();}});
    if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');this.render();
  }
  close(force=false){if(!this.dialog||this.busy&&!force)return;const dialog=this.dialog;this.dialog=null;if(dialog.open&&dialog.close)dialog.close();dialog.remove();if(this.previousFocus&&this.previousFocus.focus)this.previousFocus.focus();}
  dispose(){this.close(true);}
  async run(action){
    if(this.busy||!this.dialog)return;const editor=this.editor;
    if(editor.projectGeneration!==this.generation){this.close(true);return editor.toast('El proyecto cambió. Abre de nuevo su contenido.');}
    this.busy=true;const dialog=this.dialog,states=Array.from(dialog.querySelectorAll('button,select')).map(node=>[node,node.disabled]);states.forEach(([node])=>{node.disabled=true;});
    try{await action();if(this.dialog)this.render();}catch(error){if(this.feedback&&this.dialog)this.feedback.textContent=error.message||String(error);else editor.toast(error.message);}
    finally{this.busy=false;if(this.dialog===dialog){states.forEach(([node,disabled])=>{node.disabled=disabled;});this.render();}}
  }
  async visit(level,action){
    if(this.busy||!this.current())return;const editor=this.editor,generation=this.generation;this.close();
    try{if(editor.roomId!==level.id)await editor.hooks.gotoRoom(level.index);if(editor.projectGeneration!==generation)throw Error('El proyecto cambió durante la apertura del nivel.');if(editor.roomId!==level.id)throw Error('No se pudo abrir el nivel seleccionado.');if(action)await action();else editor.home();}catch(error){editor.toast(error.message);}
  }
  render(){
    if(!this.dialog)return;const editor=this.editor,storage=editor.currentProject&&editor.currentProject.storage;
    this.location.textContent='';
    if(storage&&storage.relativePath){element('strong','Carpeta en datos del servidor',this.location);element('code',storage.relativePath,this.location);element('p',storage.warning==='content_modified'?'La carpeta contiene cambios manuales; se conservan para que puedas importarlos.':storage.materialized?'Contenido actualizado · revisión '+storage.contentRevision:'SQLite conserva el proyecto; su carpeta de contenido necesita actualización.',this.location);}
    else element('p',editor.currentProject?'Este proyecto se guarda en SQLite. Su carpeta de contenido estará disponible al guardar una copia propia.':'Proyecto sin guardar: todavía no tiene una carpeta en el servidor.',this.location);
    element('small','El motor permanece en apps/ y packages/. Los niveles y recursos propios viajan en Content; Config contiene la configuración del proyecto.',this.location);
    this.list.textContent='';const canEdit=editor.canEditDocument();
    if(this.category==='Maps'){
      element('h3','Content / Maps',this.list);const levels=editor.getSceneEntries({allModules:editor.active&&canEdit}).filter(level=>level.custom||editor.document.studio&&editor.document.studio.startRoomId===level.id||level.id===editor.roomId);
      for(const level of levels){
        const row=element('article',undefined,this.list,'ed-content-map');row.dataset.levelId=level.id;
        element('h4',level.name+(level.initial?' · inicial':''),row);element('code','Content/Maps/'+level.id+'.level.json',row);
        const controls=element('div',undefined,row,'ed-content-actions');
        button(level.id===editor.roomId?'Nivel actual':'Abrir y editar',controls,()=>this.visit(level),this.busy);
        button('Renombrar',controls,()=>this.visit(level,()=>editor.studioTools.renameScene()),!canEdit||this.busy);
        button('Duplicar',controls,()=>this.visit(level,()=>editor.studioTools.duplicateScene()),!canEdit||this.busy);
        button('Inicial',controls,()=>this.run(async()=>{editor.document.setStudio({startRoomId:level.id});editor.studioTools.refreshLabels();}),!canEdit||level.initial||this.busy);
        button('Eliminar',controls,()=>this.confirmDelete(level,levels.length),!canEdit||levels.length<2||this.busy);
        const label=element('label','Módulo del nivel ',row),select=element('select',undefined,label);
        const choices=[{id:'',title:'Compartido / sin módulo'}].concat(editor.projectModules&&editor.projectModules.availableModules?editor.projectModules.availableModules():[]);
        if(level.moduleId&&!choices.some(item=>item.id===level.moduleId))choices.push({id:level.moduleId,title:level.moduleId+' (no instalado)'});
        for(const choice of choices){const option=element('option',choice.title||choice.id,select);option.value=choice.id;}
        select.value=level.moduleId||'';select.disabled=!canEdit||this.busy;
        select.addEventListener('change',()=>this.run(async()=>{const scenes=(editor.document.studio&&editor.document.studio.scenes||[]),old=scenes.find(scene=>scene.id===level.id)||{id:level.id,name:level.name},next={...old};if(select.value)next.moduleId=select.value;else delete next.moduleId;editor.document.setStudio({scenes:scenes.filter(scene=>scene.id!==level.id).concat(next)});editor.studioTools.refreshLabels();}));
      }
      button('+ Nuevo nivel',this.list,()=>{if(!this.current())return;this.close();editor.studioTools.guard(()=>editor.studioTools.newScene());},!canEdit||this.busy);
      if(!levels.length)element('p','No hay niveles editables en esta vista.',this.list);
    }else if(this.category==='Assets'){
      element('h3','Content / Assets',this.list);const imports=editor.library.exportImports();
      for(const asset of imports){const row=element('article',undefined,this.list,'ed-content-map');element('strong',asset.name||asset.path||asset.id,row);element('code',/^[a-z][a-z0-9_-]{0,99}$/.test(asset.id)?'Content/Assets/'+asset.id+'.asset.json':'Content/Assets · ID '+asset.id,row);element('p',asset.sha256?'Archivo del proyecto · SHA-256 '+asset.sha256:'Recurso pendiente de guardar',row);}
      if(!imports.length)element('p','Todavía no hay archivos importados. La biblioteca del motor no se copia al proyecto.',this.list);
      button('Importar recursos…',this.list,()=>{this.close();editor.assetInput.click();},!canEdit);
    }else{
      element('h3','Config / Project.json',this.list);element('p','Configuración, datos compartidos y módulos del proyecto. Los mapas se almacenan por separado con identificadores estables; renombrar un nivel conserva sus referencias.',this.list);
      const pre=element('pre','',this.list);pre.textContent=JSON.stringify({project:editor.projectName,initialLevel:editor.document.studio&&editor.document.studio.startRoomId||editor.roomId,modules:editor.document.studio&&editor.document.studio.moduleProfile||null},null,2);
    }
  }
  confirmDelete(level,count){
    if(this.busy||count<2||!this.current()||!this.editor.canEditDocument())return;this.list.textContent='';element('h3','Eliminar «'+level.name+'»',this.list);element('p','Se quitarán sus objetos y configuración de este proyecto. Los enlaces que apunten a este nivel dejarán de estar disponibles. Puedes deshacer antes de guardar.',this.list);
    button('Cancelar',this.list,()=>this.render());button('Eliminar nivel',this.list,()=>this.run(()=>this.editor.studioTools.deleteScene(level.id,{confirmed:true})));
  }
}
