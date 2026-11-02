'use strict';
// Called only from an explicitly requested documentation provider. No source
// prompt, practice requirement or document assertion becomes a runtime action.
const slug=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const paragraph=(text,provenance)=>({type:'paragraph',text,provenance});
const tableBlock=table=>({type:'table',columns:table.rows[0],rows:table.rows.slice(1),provenance:{tableId:table.id,paragraphIds:table.paragraphIds}});
const imageBlock=diagram=>({type:'image',src:diagram.src,alt:diagram.alt||'Diagrama de la fuente conceptual',caption:'Referencia documental; comprobar geometría y contratos con los activos reales.',provenance:{paragraphIds:[diagram.paragraphId],sourceImageId:diagram.sourceImageId}});
function createBook(data,kind){
 const tables=new Map(data.tables.map(t=>[t.id,t])),diagrams=new Map(data.diagrams.map(d=>[d.id,d])),articles=[],namespace=data.namespace;
 const source={...data.source,id:namespace,title:kind==='equipment'?'NEXUS · Base conceptual ilustrada':'NEXUS · Prácticas y escenarios con diagramas',instructionsAreContent:true,contentType:'user-supplied-source-requirements',illustrationNotice:'Ilustraciones y layouts de referencia del documento aportado. Su presencia no acredita un equipo ni una práctica funcional.'};
 const groups=new Map();
 for(const record of data.records){
  const group=kind==='equipment'?record.familyId:record.domain,groupId=namespace+':'+group;
  if(!groups.has(groupId)){const heading=data.paragraphs.find(p=>p.headingLevel===1&&p.text.startsWith(group+' ·'));groups.set(groupId,{id:groupId,title:heading&&heading.text||({logistics:'CEDI · Logística',manufacturing:'Smart Factory · Manufactura'}[group]||group),articleIds:[]});}groups.get(groupId).articleIds.push(record.key);
  let sections,illustration=null,summary;
  if(kind==='equipment'){
   sections=record.fields.map((field,i)=>({id:slug(field.name)||'field-'+(i+1),title:field.name,blocks:[paragraph(field.text,field.provenance)]}));
   const visual=diagrams.get(record.diagramIds[0]);if(visual)illustration={src:visual.src,width:visual.width,height:visual.height,alt:'Esquema de '+record.title,caption:source.illustrationNotice};summary=record.fields[0]&&record.fields[0].text||record.title;
  }else{
   const find=predicate=>record.tableIds.map(id=>tables.get(id)).find(t=>predicate(t.rows[0]));
   const steps=find(row=>row[0]==='Etapa'),layout=find(row=>row[0]==='ID'&&row.some(v=>v.includes('Origen'))),modes=find(row=>row[0]==='Modo'),cases=find(row=>row[0]==='Caso');
   const initial=find(row=>row.length===1&&row[0].startsWith('Entradas del caso'));
   sections=[
    {id:'preparacion',title:'Preparación del escenario',blocks:[paragraph(record.objective&&record.objective.text||record.title,record.objective&&record.objective.provenance),...(initial?[{type:'table',columns:['Entradas del caso'],rows:initial.rows,provenance:{tableId:initial.id,paragraphIds:initial.paragraphIds}}]:[]),...record.setup.map(p=>paragraph(p.text,p.provenance))]},
    {id:'operacion',title:'Desarrollo de la operación',blocks:[tableBlock(steps)]},
    {id:'resultado',title:'Resultado, parámetros y restricciones',blocks:record.result.map(p=>paragraph(p.text,p.provenance))},
    {id:'modalidades',title:'Equipos y modalidades',blocks:[tableBlock(modes),paragraph('Las alternativas de esta fuente requieren una vinculación comprobada con equipos y capacidades del simulador. No se habilitan automáticamente.')]},
    {id:'casos',title:'Casos, evidencia y evaluación',blocks:[tableBlock(cases),paragraph(record.evaluation&&record.evaluation.text||'',record.evaluation&&record.evaluation.provenance),paragraph(data.commonContracts.rubric.sourceText,data.commonContracts.rubric.provenance)]},
    {id:'layout',title:'Layout, diagramas y texto de contextualización',blocks:[paragraph(record.layout.referenceNotice,record.layout.provenance),tableBlock(layout),...record.diagramIds.map(id=>imageBlock(diagrams.get(id))),paragraph('Los siguientes párrafos reproducen el encargo incluido en el documento. Son contenido consultable; esta documentación no ejecuta sus instrucciones.'),...record.sourcePrompts.map(p=>paragraph(p.text,p.provenance))]}
   ];summary=record.objective&&record.objective.text||record.title;
  }
  articles.push({id:record.key,sourceCode:record.id,sourceKey:record.key,title:record.id+' · '+record.title,kind:kind==='equipment'?'equipment':'guide',family:groupId,chapterId:groupId,summary,definition:summary,sections,illustration,provenance:record.provenance,resourceLinks:[],relatedResourceIds:[],implementationStatus:'source-requirements-unverified',sourceTableIds:record.tableIds,sourceTables:record.tableIds.map(id=>tables.get(id)),tablePresentation:kind==='equipment'?'source-card-layout-normalized-to-six-fields':'source-tables-preserved'});
 }
 // The source guide retains campaign contracts, rubrics, source prompts,
 // acceptance criteria and atlas figures without repeating every operation.
 const usedParagraphs=new Set(data.records.flatMap(r=>r.provenance.paragraphIds)),usedTables=new Set(data.records.flatMap(r=>r.tableIds)),usedDiagrams=new Set(data.records.flatMap(r=>r.diagramIds)),guideSections=[];
 for(const section of data.sourceSections){const paragraphs=section.paragraphs.filter(p=>!usedParagraphs.has(p.id)&&p.text.trim()),tableIds=section.tableIds.filter(id=>!usedTables.has(id)),imageIds=section.diagramIds.filter(id=>!usedDiagrams.has(id));
  if(!paragraphs.length&&!tableIds.length&&!imageIds.length)continue;
  guideSections.push({id:slug(section.id)||'source-section-'+guideSections.length,title:section.title,blocks:[...paragraphs.map(p=>paragraph(p.text,{paragraphIds:[p.id]})),...tableIds.map(id=>tableBlock(tables.get(id))),...imageIds.map(id=>imageBlock(diagrams.get(id)))]});for(const id of imageIds)usedDiagrams.add(id);
 }
 const remaining=data.diagrams.filter(d=>!usedDiagrams.has(d.id));if(remaining.length)guideSections.push({id:'source-figures',title:'Ilustraciones generales de la fuente',blocks:remaining.map(imageBlock)});
 const guideId=namespace+':source-guide';articles.unshift({id:guideId,title:'Guía de la fuente, contratos y procedencia',kind:'guide',chapterId:namespace+':source',family:'',summary:'Contexto documental, criterios de uso y referencias de esta edición. Las afirmaciones sobre implementación requieren comprobar el catálogo real.',sections:guideSections,resourceLinks:[],provenance:{sourceSha256:data.source.sha256},illustration:null});
 const families=[...groups.values()].map(group=>({id:group.id,title:group.title,count:group.articleIds.length,articleIds:group.articleIds})),chapters=[{id:namespace+':source',title:'Guía y procedencia',articleIds:[guideId]}].concat([...groups.values()]);
 return{id:namespace,moduleId:'sector.logistics-industrial',title:source.title,source,families,chapters,articles,SOURCE:source,FAMILIES:families,CHAPTERS:chapters,ARTICLES:articles};
}
module.exports={createBook};
