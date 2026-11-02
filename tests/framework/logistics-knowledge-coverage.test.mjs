import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
const proof=require('../fixtures/logistics-document-proof.json');
const book=require('../../modules/logistica-industrial/documentation/catalog.cjs');
const index=require('../../modules/logistica-industrial/documentation/index.cjs');
const bindings=require('../../modules/logistica-industrial/contracts/knowledgeBindings.json');
const resources=require('../../modules/logistica-industrial/contracts/resourceCatalog.js');
const taxonomy=require('../../modules/logistica-industrial/contracts/libraryTaxonomy.js');
const articles=new Map(book.ARTICLES.map(article=>[article.id,article]));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalize=text=>String(text).replace(/\s+/g,' ').trim();
const blocks=book.ARTICLES.flatMap(article=>article.sections.flatMap(section=>section.blocks.map(block=>({article,section,block}))));
const native=resources.RESOURCES.filter(resource=>resource.id.startsWith('library:'));

test('the supplied document has all 198 equipment records, 319 headings and every body paragraph accounted for',()=>{
 assert.equal(proof.format,'smarttwin.user-logistics-document-proof');
 assert.equal(book.SOURCE.sha256,proof.source.sha256);assert.deepEqual(book.SOURCE.counts,proof.source.counts);
 assert.equal(book.SOURCE.instructionsAreContent,true);assert.equal(book.SOURCE.contentType,'user-supplied-conceptual-document');
 assert.equal(book.moduleId,'sector.logistics-industrial');assert.equal(articles.size,225);assert.equal(book.ARTICLES.length,225);
 assert.equal(book.ARTICLES.filter(article=>article.kind==='equipment').length,198);
 assert.deepEqual(new Set(book.coverage.coveredParagraphIds),new Set(proof.documentParagraphIds));assert.deepEqual(book.coverage.missingParagraphIds,[]);
 const headings=new Set(book.ARTICLES.flatMap(article=>[article.sourceHeading,article.title,...article.sections.map(section=>section.title)]).map(normalize));
 for(const heading of proof.headings){assert(headings.has(normalize(heading.text)),'Original heading omitted: '+heading.text);assert(book.ARTICLES.some(article=>article.provenance.paragraphIds.includes(heading.id)),'Unattributed heading: '+heading.id);}
 assert.equal(proof.headings.length,319);
 const continuation=book.supplementaryParagraphs.filter(paragraph=>paragraph.reason==='pagination-continuation');
 for(const paragraph of continuation){
  const original=proof.topLevelParagraphs.find(source=>source.id===paragraph.id);
  assert(original&&original.text===paragraph.text&&paragraph.part==='word/document.xml','Only original repeated pagination text may leave the article body.');
  assert(book.CHAPTERS.some(chapter=>normalize(chapter.title)===normalize(paragraph.text)),'A pagination continuation must repeat a preserved chapter heading, rather than hide substantive content.');
 }
 for(const paragraph of proof.topLevelParagraphs){
  if(continuation.some(repeated=>repeated.id===paragraph.id))continue;
  const candidates=blocks.filter(({block})=>(block.provenance.paragraphIds||[]).includes(paragraph.id));
  assert(candidates.some(({section,block})=>block.type==='paragraph'&&[block.text,section.title+'. '+block.text].some(text=>normalize(text)===normalize(paragraph.text))),'Paragraph text omitted or changed: '+paragraph.id);
 }
 assert.deepEqual(book.supplementaryParagraphs.filter(paragraph=>paragraph.reason==='document-header-footer').map(({id,part,text})=>({id,part,text})),proof.supplementary,'Header/footer content remains separate, rather than disappearing from the source accounting.');
 assert(book.supplementaryParagraphs.every(paragraph=>['document-header-footer','pagination-continuation'].includes(paragraph.reason)));
});

test('all source families and seven detailed fields remain attached to their own equipment article',()=>{
 const fields=['Concepto','Funcionamiento','Componentes','Tipos y variantes','Aplicaciones','Límites y selección','Configuración didáctica'];
 assert.deepEqual(book.FAMILIES.map(({id,title,count})=>({id,title,count})),proof.families);
 assert.equal(book.FAMILIES.length,12);assert.equal(index.ENTRIES.length,198);
 for(const expected of proof.equipment){
  const article=articles.get(expected.id),light=index.ENTRIES.find(entry=>entry.id===expected.id);
  assert(article&&light,'A source equipment ID must exist in both views: '+expected.id);assert.equal(article.title,expected.title);assert.equal(light.title,expected.title);
  assert.equal(article.family,expected.id.slice(0,2));assert(article.provenance.paragraphIds.includes(expected.paragraphId));assert(article.definition.length>0);
  assert.deepEqual(article.sections.map(section=>section.title),fields,expected.id+' detailed source fields');
  assert.equal(new Set(article.sections.map(section=>section.id)).size,7);assert(article.sections.every(section=>section.blocks.length));
  const chapter=book.CHAPTERS.find(chapter=>chapter.id===article.chapterId);assert(chapter&&chapter.articleIds.includes(article.id));
  const family=book.FAMILIES.find(family=>family.id===article.family);assert(family.articleIds.includes(article.id));
  assert.deepEqual(light.resourceLinks,article.resourceLinks);assert.deepEqual(article.resourceLinks,bindings.links[article.id]||[]);
 }
 assert.deepEqual(book.OPERATIONS.reduce((totals,row)=>(totals[row.domain]=(totals[row.domain]||0)+1,totals),{}),{logistics:24,manufacturing:30});
});

test('213 original tables retain every cell in order and all 209 internal links resolve',()=>{
 const tableBlocks=blocks.filter(({block})=>block.type==='table'),seen=new Set();assert.equal(tableBlocks.length,213);
 for(const expected of proof.tables){
  const matches=tableBlocks.filter(({block})=>block.provenance.tableId===expected.id);assert.equal(matches.length,1,expected.id+' must not be dropped or duplicated');
  const table=matches[0].block;seen.add(table.provenance.tableId);
  // A heading row may become semantic table columns. A generated generic
  // column label is allowed only when all original rows remain unchanged.
  assert([table.rows,[table.columns,...table.rows]].some(rows=>sha(JSON.stringify(rows))===expected.sha256),'Table cells/order changed: '+expected.id);
 }
 assert.equal(seen.size,213);assert.equal(book.sourceLinks.length,209);
 assert.deepEqual(book.sourceLinks.map(({paragraphId,text,anchor})=>({paragraphId,text,anchor})),proof.links);
 for(const link of book.sourceLinks)assert(articles.has(link.articleId),'Broken original document anchor: '+link.anchor);
 for(const chapter of book.CHAPTERS){if(chapter.parentId)assert(book.CHAPTERS.some(parent=>parent.id===chapter.parentId));for(const id of chapter.articleIds)assert(articles.has(id));}
});

test('198 bounded local PNGs are byte-identical to the supplied illustrations and have a complete private publication manifest',()=>{
 const directory=path.join(root,'modules/logistica-industrial/documentation/assets'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 assert.equal(manifest.format,'smarttwin.documentation-assets');assert.equal(manifest.moduleId,book.moduleId);assert.equal(manifest.sourceSha256,proof.source.sha256);assert.equal(manifest.files.length,198);
 assert.equal(new Set(manifest.files.map(file=>file.path)).size,198);
 assert.deepEqual(fs.readdirSync(directory).filter(name=>name.endsWith('.png')).sort(),proof.images.map(image=>image.id+'.png').sort());
 let total=0;
 for(const expected of proof.images){
  const article=articles.get(expected.id),illustration=article.illustration,file=manifest.files.find(file=>file.path===expected.id+'.png');
  assert.equal(illustration.src,'modules/logistica-industrial/documentation/assets/'+expected.id+'.png');assert(!fs.lstatSync(path.join(directory,file.path)).isSymbolicLink());
  const bytes=fs.readFileSync(path.join(directory,file.path));assert.deepEqual(Array.from(bytes.subarray(0,8)),[137,80,78,71,13,10,26,10]);
  assert.equal(sha(bytes),expected.sha256);assert.equal(illustration.sha256,expected.sha256);assert.equal(file.sha256,expected.sha256);assert.equal(file.bytes,expected.bytes);assert.equal(bytes.length,expected.bytes);
  assert.equal(bytes.readUInt32BE(16),expected.width);assert.equal(bytes.readUInt32BE(20),expected.height);assert.equal(illustration.sourceMedia,expected.sourceMedia);
  assert(article.provenance.imageIds.includes(expected.sourceImageId));assert(bytes.length<2*1024*1024);total+=bytes.length;
 }
 assert(total<8*1024*1024);
});

test('all native resources stay real; related-only conceptual equipment never gains an insertion action',()=>{
 assert.equal(native.length,108);assert.equal(new Set(native.map(resource=>resource.id)).size,108);
 const byId=new Map(native.map(resource=>[resource.id,resource]));
 const pending=taxonomy.pendingResources(native),decorated=taxonomy.decorate(native),pendingById=new Map(pending.map(resource=>[resource.articleId,resource]));
 for(const expected of proof.equipment){
  const links=bindings.links[expected.id]||[],exact=links.filter(link=>link.relation==='exact');
  for(const link of links){assert(['exact','family'].includes(link.relation));assert(byId.has(link.resourceId),'Documentation references a missing native resource: '+link.resourceId);}
  const ready=exact.some(link=>{const resource=byId.get(link.resourceId);return resource.status==='functional'&&resource.action;});
  assert.equal(pendingById.has(expected.id),!ready,'A family reference cannot masquerade as this native machine: '+expected.id);
  if(!ready){const resource=pendingById.get(expected.id);assert.equal(resource.status,'development');assert.equal(resource.action,null);assert(resource.reason);}
  for(const link of exact){const resource=byId.get(link.resourceId);assert.equal(resource.status,'functional');assert(resource.action,'Exact represented type must have a real action.');}
 }
 for(let i=0;i<native.length;i++){assert.equal(decorated[i].action,native[i].action,'Decoration must reuse the existing action.');assert(decorated[i].documentationLinks.every(link=>articles.has(link.articleId)));assert(taxonomy.memberships(decorated[i]).length);}
 const assets=require('../../packages/tools/editor/assets/catalog.json');assert.equal(assets.length,188);
 for(const asset of assets){const resource=resources.assetResource(asset);assert.equal(resource.asset,asset,'Library browsing retains the original asset; it does not synthesize a replacement model.');}
});

test('lightweight taxonomy can load without the full document body or its illustrations',()=>{
 const child=spawnSync(process.execPath,['-e',"require('./modules/logistica-industrial/documentation/index.cjs');console.log(JSON.stringify(Object.keys(require.cache).filter(name=>/documentation[\\\\/](?:catalog|assets)/.test(name))))"],{cwd:root,encoding:'utf8',windowsHide:true});
 assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),[]);
 assert(fs.statSync(path.join(root,'modules/logistica-industrial/documentation/index-data.json')).size<256*1024);
 assert(index.ENTRIES.every(entry=>!Object.hasOwn(entry,'sections')&&!Object.hasOwn(entry,'blocks')));
});
