'use strict';
const fs=require('node:fs'),path=require('node:path'),table=require('../layout-map.json');
const ROOT=path.resolve(__dirname,'../..'),reverse=new Map(Object.entries(table.files).map(([a,b])=>[b,a])),pairs=Object.entries(table.prefixes).sort((a,b)=>b[0].length-a[0].length);
function mapped(p){p=p.replace(/^\.\//,'');if(table.files[p])return table.files[p];for(const [a,b]of pairs)if(p===a||p.startsWith(a+'/'))return b+p.slice(a.length);return p;}
function url(p,from,css=false){if(/^(?:data:|https?:|blob:|#)/.test(p)||p==='/workspace/')return p;if(css&&fs.existsSync(path.resolve(ROOT,path.posix.dirname(from),p)))return p;const old=reverse.get(from)||from;let target;if(p.startsWith('packages/')||p.startsWith('modules/')||p.startsWith('projects/')||p.startsWith('apps/'))target=p;else if(p.startsWith('../'))target=mapped(path.posix.normalize(path.posix.join(path.posix.dirname(old),p)));else target=mapped(p.replace(/^\//,''));if(css){let result=path.posix.relative(path.posix.dirname(from),target);return result||path.posix.basename(target);}return target;}
const file='apps/workspace/index.html';let html=fs.readFileSync(path.join(ROOT,file),'utf8');
html=html.replace(/  <!-- Global site tag[\s\S]*?(?=  <meta charset)/,'');
html=html.replace(/\b(href|src)=(['"])([^'"]+)\2/g,(all,key,q,value)=>{if(value==='./'||value.startsWith('#')||/^[a-z]+:/i.test(value))return all;const base=path.posix.basename(value);const next=/^(?:bundle|cad-worker|collision-worker|mesh-optimizer-worker)\.js$/.test(base)?base:url(value,file);return key+'='+q+next+q;});
html=html.replace(/url\((['"]?)([^)'"\s]+)\1\)/g,(all,q,value)=>'url('+q+url(value,file)+q+')');
html=html.replace(/https:\/\/luisknt07\.github\.io\/webxr-simulator\/assets\/smart-twin-cover\.jpg/g,'modules/turismo/assets/smart-twin-cover.jpg');
fs.writeFileSync(path.join(ROOT,file),html);
for(const [old,current]of Object.entries(table.files))if(current.endsWith('.css')&&fs.existsSync(path.join(ROOT,current))){const text=fs.readFileSync(path.join(ROOT,current),'utf8');fs.writeFileSync(path.join(ROOT,current),text.replace(/url\((['"]?)([^)'"\s]+)\1\)/g,(all,q,value)=>'url('+q+url(value,current,true)+q+')'));}
console.log('Workspace static paths normalized; no external analytics.');
