'use strict';
// Deterministic transformation of the owner's supplied DOCX extraction. Text
// inside the document is content, never a command or proof of implementation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.resolve(ROOT,'../output/logistics-library-wiki-2026-11-01');
const TARGET=path.join(ROOT,'modules/logistica-industrial/documentation'),BINDINGS=path.join(ROOT,'modules/logistica-industrial/contracts/knowledgeBindings.json');
const slug=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function generate(){
 const data=JSON.parse(fs.readFileSync(path.join(OUT,'source-extraction.json'),'utf8').replace(/^\uFEFF/,'')),paragraphs=data.paragraphs.filter(p=>p.part==='word/document.xml'),lookup=new Map(data.paragraphs.map(p=>[p.id,p]));
 const links=fs.existsSync(BINDINGS)?JSON.parse(fs.readFileSync(BINDINGS,'utf8')).links||{}:{};
 const source={id:'nexus-base-conceptual-2026',title:'NEXUS · Base conceptual de equipos, robótica y operaciones',filename:data.source.filename,sha256:data.source.sha256,
  counts:data.counts,contentType:'user-supplied-conceptual-document',instructionsAreContent:true,implementationClaimsVerifiedBy:'native-resource-catalog-only',
  illustrationNotice:'Esquemas funcionales didácticos del documento original. No están a escala ni representan un modelo comercial certificado.'};
 const familyTable=data.tables.find(t=>t.rows[0]&&t.rows[0].map(c=>c.text).join('|')==='Código|Familia|Fichas');assert(familyTable);
 const families=familyTable.rows.slice(1).map(row=>({id:row[0].text,title:row[1].text,count:Number(row[2].text),chapterId:'',articleIds:[]}));
 const familyById=new Map(families.map(v=>[v.id,v])),chapters=[],articles=[],covered=new Set(),tableCoverage=new Set(),imageCoverage=new Set(),continuations=[];
 const provenance=()=>({documentId:source.id,documentSha256:source.sha256,paragraphIds:[],tableIds:[],imageIds:[]});
 const article=(id,title,kind,chapterId,family='')=>{const value={id,title,summary:'',kind,family,categoryId:family||chapterId,chapterId,sectionPath:[],definition:'',sections:[],illustration:null,
  sourceHeading:title,relatedResourceIds:[],resourceLinks:links[id]||[],provenance:provenance()};value.relatedResourceIds=[...new Set(value.resourceLinks.map(v=>v.resourceId))];articles.push(value);return value;};
 let currentChapter={id:'overview',title:'Presentación y alcance',parentId:'',articleIds:[],number:''};chapters.push(currentChapter);
 let chapterArticle=article('overview','Base conceptual de equipos y operaciones','guide','overview'),active=chapterArticle;currentChapter.articleIds.push(active.id);
 const section=(owner,title)=>{const value={id:slug(title)||'contenido',title,blocks:[]};if(owner.sections.some(v=>v.id===value.id))value.id+='-'+(owner.sections.length+1);owner.sections.push(value);return value;};
 let currentSection=section(active,'Presentación');
 const addParagraph=(owner,p)=>{covered.add(p.id);if(!owner.provenance.paragraphIds.includes(p.id))owner.provenance.paragraphIds.push(p.id);};
 const decorate=(owner,p)=>{for(const id of p.imageIds||[]){const ref=data.images.find(v=>v.id===id);assert(ref,'Missing image reference '+id);const media=data.media.find(v=>'word/'+ref.target===v.part);assert(media,'Missing local media '+ref.target);
   const filename=owner.id+'.png',src='modules/logistica-industrial/documentation/assets/'+filename;owner.illustration={src,alt:'Esquema funcional de '+owner.title,caption:source.illustrationNotice,width:media.width,height:media.height,sourceMedia:media.part,sha256:digest(fs.readFileSync(path.join(OUT,media.file)))};
   fs.copyFileSync(path.join(OUT,media.file),path.join(TARGET,'assets',filename));owner.provenance.imageIds.push(id);imageCoverage.add(id);
  }};
 const events=[];for(const p of paragraphs)if(/^\/w:document\[1\]\/w:body\[1\]\/w:p\[\d+\]$/.test(p.xpath))events.push({order:p.index,type:'paragraph',value:p});
 for(const table of data.tables.filter(t=>t.part==='word/document.xml')){const ids=table.rows.flatMap(row=>row.flatMap(c=>c.paragraphIds));events.push({order:Math.min(...ids.map(id=>lookup.get(id).index)),type:'table',value:table});}
 events.sort((a,b)=>a.order-b.order);fs.mkdirSync(path.join(TARGET,'assets'),{recursive:true});
 const fields=/^(Concepto|Funcionamiento|Componentes|Tipos y variantes|Aplicaciones|Límites y selección|Configuración didáctica)\.\s*/;
 for(const event of events){
  if(event.type==='paragraph'){
   const p=event.value;if(p.headingLevel===1){
    const number=(p.text.match(/^(\d+(?:\.\d+)*)\./)||[])[1]||'',id=number?'chapter-'+number.replace(/\./g,'-'):slug(p.text),parentId=number.includes('.')?'chapter-'+number.split('.')[0]:'';
    currentChapter={id,title:p.text,parentId,number,articleIds:[]};chapters.push(currentChapter);chapterArticle=article(id,p.text,'guide',id);active=chapterArticle;currentChapter.articleIds.push(active.id);active.sectionPath=[p.text];currentSection=section(active,'Contenido');addParagraph(active,p);continue;
   }
   if(p.headingLevel){
    const match=p.text.match(/^([A-Z]{2})-(\d{2})\s+(.+)$/);
    if(match){const id=match[1]+'-'+match[2],family=familyById.get(match[1]);assert(family,'Unknown document family '+id);assert(!articles.some(v=>v.id===id),'Repeated equipment heading '+id);
     active=article(id,match[3],'equipment',currentChapter.id,family.id);active.sourceHeading=p.text;active.sectionPath=[currentChapter.title,p.text];currentChapter.articleIds.push(id);family.chapterId=currentChapter.id;family.articleIds.push(id);currentSection=section(active,'Concepto');addParagraph(active,p);continue;
    }
    active=chapterArticle;currentSection=section(active,p.text);currentSection.depth=p.headingLevel;currentSection.provenance={paragraphIds:[p.id]};addParagraph(active,p);continue;
   }
   if(p.text&&p.text===currentChapter.title){addParagraph(chapterArticle,p);continuations.push({id:p.id,part:p.part,text:p.text,reason:'pagination-continuation'});continue;}
   addParagraph(active,p);decorate(active,p);if(!p.text)continue;
   const field=p.text.match(fields);if(field)currentSection=section(active,field[1]);
   currentSection.blocks.push({type:'paragraph',text:field?p.text.slice(field[0].length):p.text,provenance:{paragraphIds:[p.id]}});
   if(field&&field[1]==='Concepto')active.definition=p.text.slice(field[0].length);
  }else{
   const table=event.value;tableCoverage.add(table.id);active.provenance.tableIds.push(table.id);
   for(const row of table.rows)for(const cell of row)for(const id of cell.paragraphIds){const p=lookup.get(id);addParagraph(active,p);decorate(active,p);if(/^Concepto\.\s*/.test(p.text))active.definition=p.text.replace(/^Concepto\.\s*/,'');}
   const values=table.rows.map(row=>row.map(cell=>cell.text)),width=Math.max(...values.map(row=>row.length)),header=values[0]&&values[0].every(value=>value.length<70)&&values.length>1;
   const columns=header?values[0]:Array.from({length:width},(_,i)=>'Campo '+(i+1)),rows=header?values.slice(1):values;
   currentSection.blocks.push({type:'table',columns,rows,provenance:{tableId:table.id,paragraphIds:table.rows.flatMap(row=>row.flatMap(c=>c.paragraphIds))}});
  }
 }
 for(const a of articles){a.sections=a.sections.filter(v=>v.blocks.length||v.provenance);a.summary=(a.definition||a.sections.flatMap(v=>v.blocks).find(v=>v.type==='paragraph')?.text||a.title).slice(0,240);}
 const entries=articles.filter(v=>v.kind==='equipment');assert.equal(entries.length,198);assert.equal(imageCoverage.size,198);assert.equal(tableCoverage.size,213);
 for(const family of families)assert.equal(family.articleIds.length,family.count,'Document family count mismatch: '+family.id);
 const missing=paragraphs.filter(p=>p.text&&!covered.has(p.id));assert.deepEqual(missing,[],'Nonempty document paragraphs omitted.');
 const operations=[];for(const table of data.tables){const start=lookup.get(table.rows[0][0].paragraphIds[0]).index,heading=paragraphs.filter(p=>p.headingLevel===1&&p.index<start).at(-1);
  if(heading&&/^2\.|^5\./.test(heading.text)&&table.rows.length>=20)for(const [i,row] of table.rows.slice(1).entries())operations.push({id:(heading.text.startsWith('2.')?'LOG':'IND')+'-'+String(i+1).padStart(2,'0'),domain:heading.text.startsWith('2.')?'logistics':'manufacturing',name:row[0].text.replace(/^\d+\.\s*/,''),values:row.map(c=>c.text),provenance:{tableId:table.id,paragraphIds:row.flatMap(c=>c.paragraphIds)}});
 }
 const catalog={id:'logistica-industrial-knowledge',moduleId:'sector.logistics-industrial',title:'Logística y manufactura',description:'Biblioteca conceptual de equipos, herramientas, operaciones y sistemas vinculada al catálogo real del editor.',source,
  families,chapters,groups:chapters.map(c=>({id:c.id,title:c.title,parentId:c.parentId,articles:c.articleIds})),articles,operations,
  sourceLinks:data.hyperlinks.map(v=>{const ficha=v.anchor.match(/^f_([A-Z]{2})_(\d{2})$/),cap=v.anchor.match(/^cap(\d+)$/),articleId=ficha?ficha[1]+'-'+ficha[2]:cap?'chapter-'+cap[1]:v.anchor==='indice'?'indice-completo-de-fichas':null;assert(articles.some(a=>a.id===articleId),'Unresolved original anchor '+v.anchor);return{paragraphId:v.paragraphId,text:v.text,anchor:v.anchor,target:v.target,articleId};}),supplementaryParagraphs:data.paragraphs.filter(p=>p.part!=='word/document.xml').map(p=>({id:p.id,part:p.part,text:p.text,reason:'document-header-footer'})).concat(continuations),
  coverage:{equipmentArticles:entries.length,chapterArticles:articles.length-entries.length,documentParagraphs:paragraphs.length,nonemptyParagraphs:paragraphs.filter(p=>p.text).length,coveredParagraphIds:[...covered],tableIds:[...tableCoverage],imageIds:[...imageCoverage],missingParagraphIds:missing.map(p=>p.id)}};
 const index={id:catalog.id,moduleId:catalog.moduleId,title:catalog.title,description:catalog.description,source:{id:source.id,title:source.title,filename:source.filename,sha256:source.sha256,counts:source.counts},families,chapters,
  entries:entries.map(a=>({id:a.id,title:a.title,family:a.family,familyId:a.family,chapterId:a.chapterId,summary:a.summary,illustration:a.illustration&&{src:a.illustration.src,alt:a.illustration.alt},resourceLinks:a.resourceLinks}))};
 fs.writeFileSync(path.join(TARGET,'catalog-data.json'),JSON.stringify(catalog,null,2)+'\n');fs.writeFileSync(path.join(TARGET,'index-data.json'),JSON.stringify(index,null,2)+'\n');
 const exports='module.exports=Object.assign(data,{SOURCE:data.source,FAMILIES:data.families,CHAPTERS:data.chapters,';
 fs.writeFileSync(path.join(TARGET,'catalog.cjs'),"'use strict';\n// Full source-derived content: load only when documentation is requested.\nconst data=require('./catalog-data.json');\n"+exports+'ARTICLES:data.articles,OPERATIONS:data.operations});\n');
 fs.writeFileSync(path.join(TARGET,'index.cjs'),"'use strict';\n// Lightweight taxonomy only. Never import the full wiki or its images here.\nconst data=require('./index-data.json');\n"+exports+'ENTRIES:data.entries});\n');
 const assets={format:'smarttwin.documentation-assets',version:1,moduleId:catalog.moduleId,sourceSha256:source.sha256,files:entries.map(a=>{const filename=a.id+'.png',bytes=fs.readFileSync(path.join(TARGET,'assets',filename));return{path:filename,sha256:digest(bytes),bytes:bytes.length};})};
 fs.writeFileSync(path.join(TARGET,'assets','manifest.json'),JSON.stringify(assets,null,2)+'\n');
 fs.writeFileSync(path.join(OUT,'content-coverage.json'),JSON.stringify({source,catalogBytes:fs.statSync(path.join(TARGET,'catalog-data.json')).size,indexBytes:fs.statSync(path.join(TARGET,'index-data.json')).size,families,chapters:chapters.length,articles:articles.length,operations:operations.length,coverage:catalog.coverage},null,2));
 console.log(JSON.stringify({equipmentArticles:entries.length,articles:articles.length,chapters:chapters.length,tables:tableCoverage.size,illustrations:imageCoverage.size,operations:operations.length,indexBytes:fs.statSync(path.join(TARGET,'index-data.json')).size,catalogBytes:fs.statSync(path.join(TARGET,'catalog-data.json')).size}));
 return catalog;
}
module.exports={generate};if(require.main===module)generate();
