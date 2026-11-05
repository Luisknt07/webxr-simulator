'use strict';

/** Runtime input is a capability, never an option restored from a practice URL.
 * A saved device remains readable as historical attempt metadata; a new attempt
 * records the controls actually available now. XR support alone is not a session.
 */
function detect(context, environment={}) {
 const ctx=context||{},scope=typeof globalThis==='undefined'?{}:globalThis;
 const win=environment.window||ctx.window||ctx.document&&ctx.document.defaultView||scope.window;
 const nav=environment.navigator||win&&win.navigator||scope.navigator||{};
 const xr=ctx.renderer&&ctx.renderer.xr;
 if(xr&&xr.isPresenting===true&&typeof xr.getSession==='function'){
  try{if(xr.getSession())return 'vr';}catch(_){/* A closing XR session falls back to native browser controls. */}
 }
 const matches=query=>{try{return!!(win&&win.matchMedia&&win.matchMedia(query).matches);}catch(_){return false;}};
 // Primary pointer avoids replacing desktop keyboard/mouse controls merely
 // because a laptop also has a touchscreen. Width and saved selectors do not
 // decide the input mode; a narrow desktop is still a desktop.
 const touch=Number(nav.maxTouchPoints)>0||!!(win&&'ontouchstart'in win);
 if(matches('(pointer: coarse)')&&(touch||matches('(hover: none)')))return 'mobile';
 return 'desktop';
}
function settings(value, context, environment){return Object.assign({},value||{},{device:detect(context,environment)});}
function description(context,environment){const device=detect(context,environment);return device==='vr'?'Mandos RV activos':device==='mobile'?'Controles táctiles automáticos':'Teclado y ratón automáticos';}
module.exports={detect,settings,description};
