'use strict';
// Shared by HTTP routing and browser navigation. Filters/settings alone never
// authorize starting the default world; a concrete selection must be present.
const SELECTIONS=['practice','scene','libraryScene','project'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
function hasPlaySelection(params){return SELECTIONS.some(key=>ID.test(params.get(key)||''));}
function playEntry(params){return hasPlaySelection(params)?'index.html':'catalogue.html';}
function practiceURL(origin,id,settings){
 if(!/^(?:CEDI|SF)-0[1-5]$/.test(id))throw Error('Práctica no disponible.');
 const encoded=JSON.stringify(settings);if(encoded.length>30000)throw Error('La configuración supera el tamaño permitido.');
 const url=new URL('/play',origin);url.searchParams.set('practice',id);url.searchParams.set('settings',encoded);
 for(const key of ['mode','caseId','difficulty'])url.searchParams.set(key,String(settings[key]));
 return url.href;
}
module.exports={hasPlaySelection,playEntry,practiceURL};
