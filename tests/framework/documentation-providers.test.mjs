import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),file=fileURLToPath(new URL('../../modules/logistica-industrial/integrations/StudioTools.js',import.meta.url));
const text=fs.readFileSync(file,'utf8'),begin=text.indexOf('  documentationProviders() {'),end=text.indexOf('\n  openWorkspace(',begin);assert(begin>=0&&end>begin);
const method=text.slice(begin,end),imports=/import\(\/\* webpackChunkName: "[a-z0-9-]+" \*\/ '([^']+)'\)/g;
const paths=[...method.matchAll(imports)].map(row=>row[1]);
assert.deepEqual(paths,['../practices/configurable/documentation/PracticeBook.cjs','../documentation/catalog.cjs','../practices/documentation/equipment-book.cjs','../practices/documentation/practice-book.cjs'],'Only the four reviewed local source books may load.');
function fixture(){
 const loads=[],resources=[],editor={projectModules:{canShowLevel:moduleId=>moduleId==='sector.logistics-industrial'&&editor.enabled},enabled:true,resourceBrowser:{resources}};
 const loadBook=async relative=>{assert(paths.includes(relative));loads.push(relative);return{default:require(path.resolve(path.dirname(file),relative))};};
 const Tools=new Function('loadBook','return class SourceProviders {\n'+method.replace(imports,(_,relative)=>'loadBook('+JSON.stringify(relative)+')')+'\n}')(loadBook),tools=new Tools();tools.editor=editor;
 return{loads,resources,editor,providers:tools.documentationProviders()};
}

test('the actual editor offers four lazy source providers with unambiguous namespaces and live module guards',()=>{
 const f=fixture();assert.equal(f.providers.length,4);assert.deepEqual(f.loads,[],'The current book and historical archives are loaded only on request.');
 assert.deepEqual(f.providers.map(row=>row.id),['sector.logistics-industrial:configurable','sector.logistics-industrial','sector.logistics-industrial:illustrated','sector.logistics-industrial:practices']);
 for(const [articleId,expected]of [['smarttwin-configurable-2026:CEDI-01',0],['TR-03',1],['nexus-illustrated-2026:TR-03',2],['nexus-practices-2026:L01',3]])assert.deepEqual(f.providers.map((provider,index)=>provider.accepts(articleId)?index:null).filter(value=>value!==null),[expected],articleId+' must select one source, not a similarly numbered replacement.');
 assert(f.providers.every(provider=>provider.moduleId==='sector.logistics-industrial'&&provider.available()));f.editor.enabled=false;assert(f.providers.every(provider=>!provider.available()),'Removing a module immediately withdraws every one of its books.');
});

test('the new provider loads the ten actual practice guides and enriches a private copy without mutating cached source data',async()=>{
 const f=fixture(),relative=paths[0],book=require(path.resolve(path.dirname(file),relative)),before=JSON.stringify(book),article=book.ARTICLES[0];
 f.resources.push({id:'native-source-reference',sourceRefs:[{key:article.id}]});const originalResources=JSON.stringify(f.resources),enriched=await f.providers[0].load();
 assert.deepEqual(f.loads,[relative]);assert.equal(enriched.ARTICLES.length,10);assert.deepEqual(enriched.ARTICLES.map(row=>row.id),['CEDI','SF'].flatMap(prefix=>Array.from({length:5},(_,index)=>'smarttwin-configurable-2026:'+prefix+'-'+String(index+1).padStart(2,'0'))));
 assert(enriched.ARTICLES.every(row=>row.sections.length>=6));assert(enriched.ARTICLES[0].resourceLinks.some(row=>row.resourceId==='native-source-reference'&&row.relation==='exact'));assert.notEqual(enriched.ARTICLES,book.ARTICLES);assert.equal(JSON.stringify(book),before);assert.equal(JSON.stringify(f.resources),originalResources);
});
