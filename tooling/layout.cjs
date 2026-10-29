'use strict';
// Explicit virtual paths for legacy regression fixtures and maintenance tools.
const path=require('node:path'),table=require('./layout-map.json'),root=path.resolve(__dirname,'..');
const pairs=Object.entries(table.prefixes).sort((a,b)=>b[0].length-a[0].length);
function map(value){if(typeof value!=='string')return value;const absolute=path.resolve(value),relative=path.relative(root,absolute).split(path.sep).join('/');if(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))return value;let target=table.files[relative];if(!target){for(const [a,b]of pairs)if(relative===a||relative.startsWith(a+'/')){target=b+relative.slice(a.length);break;}}return target?path.join(root,target):value;}
function oldDir(file){return path.join(root,path.posix.dirname(file));}
module.exports={root,map,oldDir,resolve:(...parts)=>map(path.resolve(...parts)),source:name=>map(path.join(root,'src',name))};
