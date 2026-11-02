'use strict';
const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value);
const text=value=>typeof value==='string'?value:'';
function safeLink(value){
 if(typeof value!=='string'||value.length>2048)return null;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch(_){return null;}
}
function safeImage(value){
 if(typeof value!=='string'||value.length>500||!/^modules\/[a-z0-9-]+\/(?:documentation\/assets|assets)\/[a-zA-Z0-9/_.-]+\.(?:png|jpe?g|webp)$/i.test(value))return null;
 return value.split('/').some(part=>!part||part==='.'||part==='..')?null:value;
}
function blockText(block){
 if(!block)return '';
 if(block.type==='table')return [].concat(block.columns||block.headers||[],...(block.rows||[])).map(cell=>typeof cell==='string'?cell:cell&&cell.text||'').join(' ');
 if(block.type==='list')return (block.items||[]).map(item=>typeof item==='string'?item:item.text||'').join(' ');
 return [block.text,block.caption,block.alt].filter(Boolean).join(' ');
}
function normalizeBook(input){
 const value=input&&input.default||input||{},articles=value.ARTICLES||value.articles||[],families=value.FAMILIES||value.families||[],chapters=value.CHAPTERS||value.chapters||[];
 if(!Array.isArray(articles)||articles.length>1000)throw Error('El catálogo de documentación no es válido.');
 const ids=new Set(),rows=articles.map(article=>{
  if(!article||!identifier(article.id)||ids.has(article.id)||!text(article.title))throw Error('La documentación contiene una ficha sin título o con identificador repetido.');
  ids.add(article.id);
  const sections=(Array.isArray(article.sections)?article.sections:[]).map((section,index)=>({
   ...section,id:identifier(section.id)?section.id:'section-'+(index+1),title:text(section.title||section.label),
   blocks:Array.isArray(section.blocks)?section.blocks:(section.paragraphs||[]).map(item=>({type:'paragraph',text:typeof item==='string'?item:item.text||''}))
  }));
  const summary=text(article.summary||article.definition),copy={...article,title:text(article.title),summary,sections};
  copy.searchText=fold([copy.id,copy.title,summary,copy.definition,copy.family,copy.chapterId].concat(...sections.map(section=>[section.title,...section.blocks.map(blockText)])).join(' '));
  return copy;
 });
 return {source:value.SOURCE||value.source||{},articles:rows,byId:new Map(rows.map(row=>[row.id,row])),families,chapters};
}
function searchArticles(book,query){const terms=fold(query).split(/\s+/).filter(Boolean);return terms.length?book.articles.filter(article=>terms.every(term=>article.searchText.includes(term))):book.articles;}
function resourceMatches(article,resources){
 const links=article.resourceLinks||article.relatedResourceIds&&article.relatedResourceIds.map(resourceId=>({resourceId,relation:'exact'}))||[];
 return links.map(link=>({resource:resources.find(resource=>resource.id===link.resourceId),relation:link.relation||'exact'})).filter(row=>row.resource);
}
function articleStatus(article,resources){
 const matches=resourceMatches(article,resources),exact=matches.filter(row=>row.relation==='exact'&&row.resource.action);
 if(exact.some(row=>row.resource.status==='functional'))return {key:'functional',label:'Recurso funcional disponible',matches};
 if(exact.some(row=>row.resource.status==='visual'))return {key:'visual',label:'Representación visual disponible',matches};
 if(matches.some(row=>row.resource.action))return {key:'related',label:'Familia relacionada en la biblioteca',matches};
 return {key:article.kind==='guide'||article.kind==='concept'?'concept':'planned',label:article.kind==='guide'||article.kind==='concept'?'Guía conceptual':'Pendiente de incorporar',matches};
}
module.exports={fold,identifier,safeLink,safeImage,blockText,normalizeBook,searchArticles,resourceMatches,articleStatus};
