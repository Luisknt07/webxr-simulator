'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../packages/tools/editor/src/EditorIcons.js'),'utf8').replace(/^export /gm,'');
 return new Function(source+'\nreturn {iconData,setEditorIcon};')();
};
