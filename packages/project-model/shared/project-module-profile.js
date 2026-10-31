'use strict';
const {cloneData,plain,identifier,version,validateProject,validateState}=require('../../contracts/index.js');

/** Authored module availability is data. It cannot install code, grant a port,
 * alter account permissions or turn a viewer into a project editor. */
function normalizeModuleProfile(input){
  if(input===undefined||input===null)return {version:1,mode:'mixed',selectedModuleId:'',modules:[]};
  const value=cloneData(input);
  if(!plain(value)||value.version!==1||!['mixed','specialized'].includes(value.mode===undefined?'mixed':value.mode)||!Array.isArray(value.modules)||value.modules.length>128)throw Error('Perfil de módulos del proyecto inválido.');
  value.mode=value.mode||'mixed';value.selectedModuleId=value.selectedModuleId===undefined?'':value.selectedModuleId;
  if(typeof value.selectedModuleId!=='string')throw Error('Selección de módulo inválida.');
  const ids=new Set();
  value.modules=value.modules.map(row=>{
    if(!plain(row))throw Error('Referencia de módulo inválida.');identifier(row.id);version(row.version);
    if(ids.has(row.id))throw Error('El perfil contiene módulos duplicados.');ids.add(row.id);
    for(const name of ['editorEnabled','viewerEnabled'])if(row[name]!==undefined&&typeof row[name]!=='boolean')throw Error('La disponibilidad de un módulo debe ser booleana.');
    // Use the same function reference boundary as the standalone project host.
    validateProject({format:'smarttwin.project',version:1,worldId:'world.profile-validation',modules:[{id:row.id,version:row.version,...(row.optional===undefined?{}:{optional:row.optional}),...(row.functions===undefined?{}:{functions:row.functions})}],entities:[]});
    return {...row,editorEnabled:row.editorEnabled!==false,viewerEnabled:row.viewerEnabled!==false};
  });
  if(value.selectedModuleId&&!ids.has(value.selectedModuleId))throw Error('El módulo seleccionado no pertenece al proyecto.');
  if(value.mode==='specialized'&&!value.selectedModuleId)throw Error('Selecciona el módulo del proyecto especializado.');
  if(value.worldId!==undefined&&(typeof value.worldId!=='string'||!value.worldId||value.worldId.length>180))throw Error('Identificador del mundo modular inválido.');
  if(value.project!==undefined){value.project=validateProject(value.project);if(value.worldId!==undefined&&value.project.worldId!==value.worldId)throw Error('El contenido modular pertenece a otro mundo.');value.worldId=value.project.worldId;}
  if(value.state!==undefined){value.state=validateState(value.state);if(value.worldId!==undefined&&value.state.worldId!==value.worldId)throw Error('El estado modular pertenece a otro mundo.');value.worldId=value.state.worldId;}
  return value;
}
function enabledModules(input,{viewer=false,moduleId=''}={}){
  const profile=normalizeModuleProfile(input),field=viewer?'viewerEnabled':'editorEnabled';
  const selected=profile.mode==='specialized'?profile.selectedModuleId:moduleId;
  return profile.modules.filter(row=>row[field]&&(!selected||row.id===selected));
}
module.exports={normalizeModuleProfile,enabledModules};
