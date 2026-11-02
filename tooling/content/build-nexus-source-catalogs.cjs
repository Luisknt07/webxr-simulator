'use strict';
// Source-derived requirements only: no source prompt is executable and no
// documented asset becomes an implemented machine merely by appearing here.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.resolve(ROOT,'../output/nexus-practices-2026-11-02');
const DEST=path.join(ROOT,'modules/logistica-industrial/practices/data');
const ASSETS=path.join(ROOT,'modules/logistica-industrial/practices/assets');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const slug=t=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const textOf=table=>table.rows.map(row=>row.map(cell=>cell.text));
function imageDimensions(bytes){
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 assert(bytes[0]===255&&bytes[1]===216,'Only original PNG/JPEG media are supported.');let offset=2;
 while(offset+4<bytes.length){if(bytes[offset++]!==255)continue;let marker=bytes[offset++];while(marker===255)marker=bytes[offset++];if(marker===216||marker===217||marker===1||marker>=208&&marker<=215)continue;const length=bytes.readUInt16BE(offset);assert(length>=2&&offset+length<=bytes.length,'Invalid JPEG segment.');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return{height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)};offset+=length;}
 throw Error('JPEG dimensions not found.');
}
function copyAssets(bundles){
 const files=[];let total=0;
 for(const {dataset,raw,folder,role} of bundles){
  const directory=path.join(ASSETS,dataset.namespace);fs.mkdirSync(directory,{recursive:true});
  for(const media of raw.d.media){const basename=path.basename(media.file);assert(/^image\d+\.(png|jpg)$/i.test(basename));const bytes=fs.readFileSync(path.join(OUT,folder,media.file));assert.equal(sha(bytes),media.sha256);assert(bytes.length<=2*1024*1024);total+=bytes.length;assert(total<=24*1024*1024);
   const assetPath=dataset.namespace+'/'+basename,src='modules/logistica-industrial/practices/assets/'+assetPath,dimensions=imageDimensions(bytes),refs=dataset.diagrams.filter(d=>d.sourceMedia===media.part),references=[];
   assert(refs.length,'Every copied original media must have document provenance.');
   for(const diagram of refs){const owner=dataset.records.find(r=>r.diagramIds.includes(diagram.id)),index=owner?owner.diagramIds.indexOf(diagram.id):-1,semanticRole=owner?(role==='equipment'?'equipment-illustration':index===0?'practice-layout':'practice-process'):role==='equipment'?'concept-diagram':'campaign-atlas';
    Object.assign(diagram,{src,...dimensions,delivery:'declared-private-workspace',role:semanticRole,ownerKey:owner?.key||null});references.push({sourceImageId:diagram.sourceImageId,paragraphId:diagram.paragraphId,ownerKey:owner?.key||null,role:semanticRole});
   }
   fs.copyFileSync(path.join(OUT,folder,media.file),path.join(ASSETS,assetPath));files.push({path:assetPath,sha256:sha(bytes),bytes:bytes.length,...dimensions,roles:[...new Set(references.map(r=>r.role))],sourceMedia:media.part,references});
  }
 }
 const manifest={format:'smarttwin.nexus-source-assets',version:1,moduleId:'sector.logistics-industrial',sources:bundles.map(b=>({namespace:b.dataset.namespace,filename:b.dataset.source.filename,sha256:b.dataset.source.sha256})),totalBytes:total,files};
 assert.equal(files.length,333);fs.writeFileSync(path.join(ASSETS,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
function load(folder,namespace){
 const d=JSON.parse(fs.readFileSync(path.join(OUT,folder,'source-extraction.json'),'utf8')),byId=new Map(d.paragraphs.map(p=>[p.id,p]));
 const paragraphs=d.paragraphs.map(p=>({id:p.id,part:p.part,index:p.index,xpath:p.xpath,headingLevel:p.headingLevel,text:p.text,imageIds:p.imageIds,fieldInstructions:p.fieldInstructions||[]}));
 const tables=d.tables.map(t=>({id:t.id,part:t.part,xpath:t.xpath,rows:textOf(t),paragraphIds:t.rows.flatMap(row=>row.flatMap(cell=>cell.paragraphIds))}));
 const diagrams=d.images.map(ref=>{const media=d.media.find(m=>m.part==='word/'+ref.target);assert(media,'Missing extracted media '+ref.target);return{id:namespace+':'+ref.id,sourceImageId:ref.id,paragraphId:ref.paragraphId,sourceMedia:media.part,sourceRelativePath:folder+'/'+media.file,sha256:media.sha256,bytes:media.bytes,width:media.width,height:media.height,alt:ref.alt||ref.name||'',delivery:'extracted-not-packaged',src:null};});
 const source={namespace,filename:d.source.filename,sha256:d.source.sha256,bytes:d.source.bytes,counts:d.counts,documentInstructionsAreData:true,executable:false,implementationStatus:'unverified-source-requirements'};
 const body=paragraphs.filter(p=>p.part==='word/document.xml');
 const tableRows=(from,to)=>tables.filter(t=>t.part==='word/document.xml'&&t.paragraphIds.some(id=>{const p=byId.get(id);return p.index>=from&&p.index<to;}));
 const sections=(from,to)=>{
  const rows=body.filter(p=>p.index>=from&&p.index<to),result=[];let current={id:'overview',title:'Descripción',paragraphs:[],tableIds:[],diagramIds:[]};result.push(current);
  const events=rows.filter(p=>!p.xpath.includes('/w:tbl')).map(p=>({order:p.index,type:'paragraph',p}));
  for(const table of tableRows(from,to))events.push({order:Math.min(...table.paragraphIds.map(id=>byId.get(id).index)),type:'table',table});events.sort((a,b)=>a.order-b.order);
  for(const e of events){if(e.type==='table'){current.tableIds.push(e.table.id);continue;}const p=e.p;if(p.headingLevel){current={id:slug(p.text)||p.id,title:p.text,headingLevel:p.headingLevel,paragraphs:[],tableIds:[],diagramIds:[],provenance:{paragraphIds:[p.id]}};result.push(current);}else{current.paragraphs.push({id:p.id,text:p.text});for(const id of p.imageIds||[])current.diagramIds.push(namespace+':'+id);}}
  return result.filter(s=>s.paragraphs.length||s.tableIds.length||s.provenance);
 };
 return{d,byId,source,paragraphs,body,tables,diagrams,tableRows,sections};
}
function generate(){
 fs.mkdirSync(DEST,{recursive:true});const equipment=load('conceptual-source','nexus-illustrated-2026'),practices=load('practices-source','nexus-practices-2026');
 const equipmentHeads=equipment.body.filter(p=>p.headingLevel&&/^[A-Z]{2}-\d{2}\s+/.test(p.text)),records=[];
 for(let i=0;i<equipmentHeads.length;i++){
  const head=equipmentHeads[i],match=head.text.match(/^([A-Z]{2})-(\d{2})\s+(.+)$/),after=equipment.body.find(p=>p.index>head.index&&p.headingLevel===1),to=Math.min(equipmentHeads[i+1]?.index||Infinity,after?.index||Infinity);
  const paragraphs=equipment.body.filter(p=>p.index>=head.index&&p.index<to),tables=equipment.tableRows(head.index,to),fields=[];
  for(const p of paragraphs){const m=p.text.match(/^([^\.\n]{3,50})\.\s+([\s\S]+)$/);if(m&&!p.headingLevel)fields.push({name:m[1],text:m[2],provenance:{paragraphIds:[p.id]}});}
  const id=match[1]+'-'+match[2],key=equipment.source.namespace+':'+id;
  records.push({id,key,namespace:equipment.source.namespace,title:match[3],familyId:match[1],kind:'documented-equipment',implementationStatus:'unverified',canonicalId:null,fields,sections:equipment.sections(head.index,to),tableIds:tables.map(t=>t.id),diagramIds:equipment.diagrams.filter(d=>paragraphs.some(p=>p.id===d.paragraphId)).map(d=>d.id),provenance:{sourceSha256:equipment.source.sha256,headingId:head.id,paragraphIds:paragraphs.map(p=>p.id)}});
 }
 assert.equal(records.length,189);assert.equal(new Set(records.map(r=>r.key)).size,189);
 const firstPracticeHeads=practices.body.filter(p=>p.headingLevel===1&&/^[LI]\d{2}\s*·/.test(p.text)&&!p.text.includes('Layout y diagrama')&&!p.text.includes('Casos y prompt'));
 const cases=[];
 for(let i=0;i<firstPracticeHeads.length;i++){
  const head=firstPracticeHeads[i],id=head.text.slice(0,3),next=firstPracticeHeads[i+1]?.index||Infinity,other=practices.body.find(p=>p.index>head.index&&p.index<next&&p.headingLevel===1&&!p.text.startsWith(id+' ')),to=Math.min(next,other?.index||Infinity);
  const paragraphs=practices.body.filter(p=>p.index>=head.index&&p.index<to),tables=practices.tableRows(head.index,to),findTable=first=>tables.find(t=>t.rows[0]&&first(t.rows[0])),stepTable=findTable(row=>row[0]==='Etapa'),layoutTable=findTable(row=>row[0]==='ID'&&row.some(v=>v.includes('Origen'))),modeTable=findTable(row=>row[0]==='Modo'),caseTable=findTable(row=>row[0]==='Caso');
  assert(stepTable&&layoutTable&&modeTable&&caseTable,'Incomplete original practice '+id);
  const meta=p=>({paragraphIds:[p.id]}),value=prefix=>{const p=paragraphs.find(p=>p.text.startsWith(prefix));return p?{text:p.text.slice(prefix.length).trim(),provenance:meta(p)}:null;};
  const areaP=paragraphs.find(p=>p.text.startsWith('Área local propuesta:')),areaMatch=areaP?.text.match(/Área local propuesta:\s*([\d.,]+)\s*×\s*([\d.,]+)\s*m/),distanceMatch=areaP?.text.match(/Polilínea representada:\s*([\d.,]+)\s*m/),numeric=v=>Number(v.replace(',','.'));
  const layout=layoutTable.rows.slice(1).map(row=>{const p=row[2].match(/\(\s*([-\d.,]+)\s*;\s*([-\d.,]+)\s*\)/),size=row[3].split('×').map(v=>numeric(v.trim()));assert(p&&size.length===3&&size.every(Number.isFinite),'Invalid source coordinate '+id);return{id:row[0],name:row[1],origin2d:{x:numeric(p[1]),y:numeric(p[2])},dimensions:{width:size[0],depth:size[1],height:size[2]},units:'m',coordinateSystem:'document-local-2d',worldMapping:'x->x, y->z',geometryStatus:'reference-unvalidated',provenance:{tableId:layoutTable.id}};});
  const promptIndex=paragraphs.find(p=>p.text.startsWith('6. Prompt para enviar'))?.index||Infinity,sourcePrompts=paragraphs.filter(p=>p.index>promptIndex&&p.text.trim()).map(p=>({text:p.text,executable:false,provenance:meta(p)}));
  const codes=[...new Set(paragraphs.flatMap(p=>p.text.match(/\b[A-Z]{2}-\d{2}\b/g)||[]))];
  cases.push({id,key:practices.source.namespace+':'+id,namespace:practices.source.namespace,title:head.text.replace(/^[LI]\d{2}\s*·\s*/,''),domain:id[0]==='L'?'logistics':'manufacturing',implementationStatus:'source-requirements-only',enabled:false,
   objective:value('Objetivo.'),initialConditions:tables.find(t=>t.rows.length===1&&t.rows[0][0].startsWith('Entradas del caso'))?.rows[0][0].replace(/^Entradas del caso\s*/,''),
   sections:practices.sections(head.index,to),setup:paragraphs.filter(p=>p.index>(paragraphs.find(v=>v.text.startsWith('1. Preparación'))?.index||0)&&p.index<(paragraphs.find(v=>v.text.startsWith('2. Desarrollo'))?.index||0)&&p.text.trim()).map(p=>({text:p.text,provenance:meta(p)})),
   steps:stepTable.rows.slice(1).map((row,j)=>({id:id+'-step-'+String(j+1).padStart(2,'0'),number:j+1,title:row[0],action:row[1],expectedEvidence:row[2],eventBinding:null,provenance:{tableId:stepTable.id}})),
   result:paragraphs.filter(p=>p.index>(paragraphs.find(v=>v.text.startsWith('3. Resultado'))?.index||Infinity)&&p.index<(paragraphs.find(v=>v.text===id+' · Layout y diagrama')?.index||Infinity)&&p.text.trim()).map(p=>({text:p.text,provenance:meta(p)})),
   parameters:value('Parámetros configurables.'),incident:value('Error a ensayar.'),evaluation:value('Evaluación.'),modes:modeTable.rows.slice(1).map(row=>({name:row[0],eligibleVariants:row[1],actions:row[2],implementationStatus:'unverified',provenance:{tableId:modeTable.id}})),
   cases:caseTable.rows.slice(1).map(row=>({id:row[0].slice(0,1),name:row[0],condition:row[1],verifiableAchievement:row[2],implementationStatus:'unverified',provenance:{tableId:caseTable.id}})),
   layout:{units:'m',area:areaMatch?{width:numeric(areaMatch[1]),depth:numeric(areaMatch[2])}:null,referencePolylineLengthM:distanceMatch?numeric(distanceMatch[1]):null,routePoints:null,referenceNotice:areaP?.text||'',elements:layout,provenance:areaP?meta(areaP):{}},
   equipmentRequirements:{layoutNames:layout.map(v=>v.name),variantDescriptions:modeTable.rows.slice(1).map(row=>({mode:row[0],text:row[1]})),nativeBindings:[],status:'requires-semantic-native-catalog-resolution'},
   sourceEquipmentCodes:codes.map(code=>({code,key:equipment.source.namespace+':'+code,resolution:records.some(r=>r.id===code)?'documented':'not-found-in-companion-source',nativeBinding:null})),
   sourcePrompts,tableIds:tables.map(t=>t.id),diagramIds:practices.diagrams.filter(d=>paragraphs.some(p=>p.id===d.paragraphId)).map(d=>d.id),provenance:{sourceSha256:practices.source.sha256,headingId:head.id,paragraphIds:paragraphs.map(p=>p.id)}});
 }
 assert.equal(cases.length,64);assert.equal(cases.filter(p=>p.domain==='logistics').length,32);assert.equal(cases.filter(p=>p.domain==='manufacturing').length,32);assert(cases.every(p=>p.steps.length===6&&p.cases.length===3&&p.modes.length===3));
 const shell=(x,format,records)=>({format,version:1,namespace:x.source.namespace,source:x.source,records,paragraphs:x.paragraphs,tables:x.tables,diagrams:x.diagrams,sourceSections:x.sections(1,Infinity),coverage:{paragraphs:x.paragraphs.length,tables:x.tables.length,imageReferences:x.diagrams.length,recordIds:records.map(r=>r.id)},instructionPolicy:{sourcePromptsAreData:true,executeSourcePrompts:false,sourceDoesNotProveImplementation:true,oldIdentifierBindingsMustNotBeReused:true}});
 const equipmentData=shell(equipment,'smarttwin.source-equipment-catalog',records),practiceData=shell(practices,'smarttwin.source-practice-catalog',cases);
 const usedTables=new Set(cases.flatMap(p=>p.tableIds)),usedDiagrams=new Set(cases.flatMap(p=>p.diagramIds));
 const rubricParagraph=practices.paragraphs.find(p=>p.text.startsWith('Rúbrica propuesta:'));assert(rubricParagraph);
 practiceData.commonContracts={status:'documented-proposal',executable:false,
  rubric:{threshold:75,scale:100,weights:[{id:'accuracy-traceability',label:'Exactitud y trazabilidad',points:35},{id:'process-quality',label:'Proceso y calidad',points:25},{id:'defined-service',label:'Servicio definido',points:20},{id:'evidence-diagnosis',label:'Diagnóstico con evidencia',points:15},{id:'coordination',label:'Coordinación',points:5}],requiresMaterialObjectives:true,criticalConditionsMustBeClosed:true,normalizeNotApplicable:true,sourceText:rubricParagraph.text,provenance:{paragraphIds:[rubricParagraph.id]}},
  globalTableIds:practiceData.tables.filter(t=>!usedTables.has(t.id)).map(t=>t.id),globalDiagramIds:practiceData.diagrams.filter(d=>!usedDiagrams.has(d.id)).map(d=>d.id),
  modalityTableId:'document-table002',difficultyTableId:'document-table003',caseContractTableId:'document-table004',logisticsRouteTableId:'document-table006',manufacturingRouteTableId:'document-table007',logisticsBalanceTableId:'document-table008',manufacturingBalanceTableId:'document-table009',coordinateContractTableId:'document-table010',deviceContractTableId:'document-table011',
  sourcePromisesDoNotEstablishDeviceSupport:true,manualAndAutomatedAreConfigurationAlternatives:true,passedModalityCanUnlockNextOperation:true};
 const assetManifest=copyAssets([{dataset:equipmentData,raw:equipment,folder:'conceptual-source',role:'equipment'},{dataset:practiceData,raw:practices,folder:'practices-source',role:'practice'}]);
 fs.writeFileSync(path.join(DEST,'source-equipment.json'),JSON.stringify(equipmentData,null,2)+'\n');fs.writeFileSync(path.join(DEST,'source-practices.json'),JSON.stringify(practiceData,null,2)+'\n');
 const thinDiagram=d=>d?{id:d.id,src:d.src,width:d.width,height:d.height,role:d.role,ownerKey:d.ownerKey}:null;
 const equipmentIndex={format:'smarttwin.source-equipment-index',version:1,namespace:equipmentData.namespace,source:equipmentData.source,
  families:[...new Set(records.map(r=>r.familyId))].map(id=>({id,count:records.filter(r=>r.familyId===id).length})),diagrams:equipmentData.diagrams.map(thinDiagram),entries:records.map(r=>({id:r.id,key:r.key,namespace:r.namespace,title:r.title,familyId:r.familyId,summary:(r.fields[0]?.text||r.title).slice(0,300),fieldNames:r.fields.map(f=>f.name),diagramIds:r.diagramIds,illustration:thinDiagram(equipmentData.diagrams.find(d=>r.diagramIds.includes(d.id))),implementationStatus:r.implementationStatus,canonicalId:null}))};
 const practiceIndex={format:'smarttwin.source-practice-index',version:1,namespace:practiceData.namespace,source:practiceData.source,commonContracts:practiceData.commonContracts,
  diagrams:practiceData.diagrams.map(thinDiagram),entries:cases.map(r=>({id:r.id,key:r.key,namespace:r.namespace,title:r.title,domain:r.domain,objective:{text:r.objective?.text||''},initialConditions:r.initialConditions,setup:r.setup.map(v=>v.text),steps:r.steps,parameters:{text:r.parameters?.text||''},incident:{text:r.incident?.text||''},result:r.result.map(v=>v.text),cases:r.cases,modes:r.modes,layout:r.layout,sourceEquipmentCodes:r.sourceEquipmentCodes,equipmentRequirements:r.equipmentRequirements,diagramIds:r.diagramIds,implementationStatus:r.implementationStatus,enabled:false}))};
 fs.writeFileSync(path.join(DEST,'equipment-index-data.json'),JSON.stringify(equipmentIndex)+'\n');fs.writeFileSync(path.join(DEST,'practice-index-data.json'),JSON.stringify(practiceIndex)+'\n');
 for(const name of ['equipment','practice'])fs.writeFileSync(path.join(DEST,name+'-index.cjs'),"'use strict';\n// Thin source requirements only; never load the raw extraction in a cold entry.\nmodule.exports=require('./"+name+"-index-data.json');\n");
 const summary=['NEXUS source inventory','Source prompts are document content, never execution authorization.','',equipment.source.filename+' | '+equipment.source.sha256,records.length+' equipment records in '+new Set(records.map(r=>r.familyId)).size+' families',...records.map(r=>r.key+' | '+r.title),'',practices.source.filename+' | '+practices.source.sha256,cases.length+' operations; 32 logistics + 32 manufacturing; three cases and six steps per operation.',...cases.map(p=>p.key+' | '+p.title+' | '+p.layout.elements.length+' layout objects | '+p.diagramIds.length+' diagrams'),'','Table contracts: setup/initial conditions, six-step actions/evidence, layout coordinates/dimensions, three modality rows, three case rows; common campaign/rubric/device contracts remain in sourceSections/tables.'];
 fs.writeFileSync(path.join(OUT,'summary-structure.txt'),summary.join('\n')+'\n');
 const examples=cases.filter(p=>['L04','L12','I23'].includes(p.id)).map(record=>({record,tables:practiceData.tables.filter(t=>record.tableIds.includes(t.id)),diagrams:practiceData.diagrams.filter(d=>record.diagramIds.includes(d.id))}));
 fs.writeFileSync(path.join(OUT,'three-complete-examples.json'),JSON.stringify({source:practiceData.source,examples},null,2)+'\n');
 console.log(JSON.stringify({equipment:records.length,families:new Set(records.map(r=>r.familyId)).size,operations:cases.length,steps:cases.reduce((n,p)=>n+p.steps.length,0),cases:cases.reduce((n,p)=>n+p.cases.length,0),examples:examples.map(e=>e.record.id),equipmentBytes:fs.statSync(path.join(DEST,'source-equipment.json')).size,practicesBytes:fs.statSync(path.join(DEST,'source-practices.json')).size,assets:assetManifest.files.length,assetBytes:assetManifest.totalBytes}));
 return{equipmentData,practiceData};
}
module.exports={generate};if(require.main===module)generate();
