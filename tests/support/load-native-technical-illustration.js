'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=THREE=>{
 const projectionSource=fs.readFileSync(path.join(__dirname,'../../packages/render-three/src/TechnicalProjection.js'),'utf8').replace(/^export function /gm,'function ').replace('export default {cameraOf, iso, depthOf};','return {cameraOf, iso, depthOf};');
 const technicalProjection=new Function(projectionSource)();
 const source=fs.readFileSync(path.join(__dirname,'../../modules/logistica-industrial/functions/presentacion/runtime/NativeTechnicalIllustration.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default {capture,build,paint,clearCache,MODES,LIMITS};','return {capture,build,paint,clearCache,MODES,LIMITS};');
 return new Function('THREE','technicalProjection',source)(THREE,technicalProjection);
};
