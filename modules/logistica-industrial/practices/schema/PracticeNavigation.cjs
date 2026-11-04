'use strict';
// Account-scoped browser navigation data. This is not an authorization boundary;
// the private attempts API still validates settings and progression.
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const practiceSettings=require('./PracticeSession.cjs');
const PRIVATE_SETTINGS_KEY='smarttwin-practice-navigation-v1:',MAX_LOCAL_SETTINGS=8,SETTINGS_TTL=86400000;
const TOKEN=/^[a-f0-9]{32}$/;
function owner(options){const value=options.userId;return typeof value==='string'&&ID.test(value)?value:'';}
function storage(options){try{return options.storage||options.window&&options.window.localStorage||null;}catch(_){return null;}}
function now(options){return typeof options.now==='number'&&Number.isFinite(options.now)?options.now:Date.now();}
function localRecords(store,userId,time){
 try{const raw=store&&store.getItem(PRIVATE_SETTINGS_KEY+userId);if(!raw||raw.length>300000)return[];const records=JSON.parse(raw);return Array.isArray(records)?records.filter(row=>row&&row.userId===userId&&TOKEN.test(row.token)&&/^(?:CEDI|SF)-0[1-5]$/.test(row.practiceId)&&Number.isFinite(row.createdAt)&&row.createdAt<=time&&time-row.createdAt<SETTINGS_TTL&&row.settings&&typeof row.settings==='object').slice(-MAX_LOCAL_SETTINGS):[];}catch(_){return[];}
}
function remember(id,settings,options){
 const userId=owner(options),store=storage(options);if(!userId||!store)return'';
 try{const random=options.crypto||options.window&&options.window.crypto||globalThis.crypto;if(!random||typeof random.getRandomValues!=='function')return'';const bytes=new Uint8Array(16);random.getRandomValues(bytes);const token=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join(''),time=now(options),records=localRecords(store,userId,time).slice(-(MAX_LOCAL_SETTINGS-1));records.push({userId,practiceId:id,token,createdAt:time,settings});store.setItem(PRIVATE_SETTINGS_KEY+userId,JSON.stringify(records));return token;}catch(_){return'';}
}
function practiceURL(origin,id,settings,options={}){
 if(!/^(?:CEDI|SF)-0[1-5]$/.test(id))throw Error('Práctica no disponible.');
 const canonical=practiceSettings.normalizeAttemptSettings(settings);if(canonical.practiceId&&canonical.practiceId!==id)throw Error('La configuración pertenece a otra práctica.');if(canonical.cediData&&!/^CEDI-0[1-5]$/.test(id))throw Error('Los datos CEDI no corresponden a esta práctica.');const url=new URL('/play',origin);url.searchParams.set('practice',id);
 // Business data belongs to the authenticated account's local book and to the
 // private attempt POST, never to URLs, browser history or copied links. A
 // bounded local reference also works across noopener editor/viewer tabs.
 for(const key of ['mode','caseId','difficulty','executionMode','evaluation','device'])url.searchParams.set(key,String(canonical[key]));
 const token=remember(id,canonical,options);if(token)url.searchParams.set('settingsRef',token);else url.searchParams.set('settingsMissing','1');
 return url.href;
}
function readPracticeSettings(params,options={}){
 const selectors={};for(const key of ['mode','caseId','executionMode','evaluation','device'])if(params.has(key))selectors[key]=params.get(key);if(params.has('difficulty'))selectors.difficulty=Number(params.get('difficulty'));
 const fallback=practiceSettings.normalizeAttemptSettings(selectors),token=params.get('settingsRef'),id=params.get('practice'),userId=owner(options);
 if(token){if(TOKEN.test(token)&&userId){const record=localRecords(storage(options),userId,now(options)).find(row=>row.token===token&&row.practiceId===id);if(record){try{const value=practiceSettings.normalizeAttemptSettings(record.settings);if(value.practiceId&&value.practiceId!==id)throw Error('Práctica distinta.');if(value.cediData&&!/^CEDI-0[1-5]$/.test(id))throw Error('Datos CEDI no aplicables.');return{settings:value,restored:true,notice:''};}catch(_){}}}return{settings:fallback,restored:false,notice:'La configuración local no está disponible para esta cuenta. Se han usado los datos predeterminados de la práctica.'};}
 // Older links may retain benign selectors, but must not transfer a supplier,
 // customer or operating book from a copied URL into another account.
 const legacy=params.get('settings');if(legacy){if(legacy.length>30000)throw Error('La configuración supera el tamaño permitido.');const value=JSON.parse(legacy);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('La configuración de la práctica no es válida.');const containedBook=Object.hasOwn(value,'cediData');delete value.cediData;return{settings:practiceSettings.normalizeAttemptSettings(value),restored:false,notice:containedBook?'Los datos operativos de enlaces antiguos no se importan desde la URL. Se han usado los datos predeterminados.':''};}
 return{settings:fallback,restored:false,notice:params.has('settingsMissing')?'El almacenamiento local no está disponible. Se han usado los ajustes predeterminados de la práctica.':''};
}
module.exports={practiceURL,readPracticeSettings};
