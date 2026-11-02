import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),model=require('../../packages/documentation/model.cjs'),book=require('../../modules/logistica-industrial/practices/configurable/documentation/PracticeBook.cjs'),publication=require('../../tooling/build/package-apps.cjs');
test('Current wiki has five practices per domain, six readable sections and all forty original diagrams',()=>{
 const normalized=model.normalizeBook(book);assert.equal(normalized.articles.length,10);assert.deepEqual(normalized.families.map(row=>row.count),[5,5]);const images=[];
 for(const article of normalized.articles){assert.equal(article.sections.length,6);assert(article.summary.length>30);for(const section of article.sections){assert(section.blocks.length>0);for(const block of section.blocks){assert(!model.blockText(block).includes('[object Object]'));if(block.type==='image'){assert.equal(model.safeImage(block.src),block.src);images.push(block.src);}}}}
 assert.equal(new Set(images).size,40);assert(model.searchArticles(normalized,'CEDI-01 recepción').some(article=>article.id==='smarttwin-configurable-2026:CEDI-01'));
});
test('New illustrations are privately packaged with byte hashes and the wiki image guard rejects traversal',()=>{
 const paths=publication.configurablePracticeAssets(process.cwd());assert.equal(paths.length,40);assert(paths.every(value=>value.startsWith('modules/logistica-industrial/practices/configurable/assets/images/')));
 for(const suffix of ['../secret.png','%2e%2e/secret.png','image.png?token=x','//evil.test/image.png'])assert.equal(model.safeImage('modules/logistica-industrial/practices/configurable/assets/'+suffix),null);
});
