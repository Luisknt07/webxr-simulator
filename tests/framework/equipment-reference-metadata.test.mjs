import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('published equipment reference metadata contains only reviewed portable fields',()=>{
 const bytes=readFileSync(new URL('../../modules/logistica-industrial/functions/presentacion/content/equipment-references.json',import.meta.url),'utf8'),data=JSON.parse(bytes);
 assert.deepEqual(Object.keys(data).sort(),['items','version']);assert.equal(data.version,1);
 const allowed=new Set(['id','equipment','kind','componentId','title','localPath','sourceUrl','sourceImageUrl','credit','caption','alt','licenseNote','width','height','sha256']);
 for(const row of data.items){for(const [key,value]of Object.entries(row)){assert(allowed.has(key),key);assert(['string','number'].includes(typeof value),row.id+': '+key+' must not contain serialized shell/provider objects');}
  for(const key of ['sourceUrl','sourceImageUrl']){const url=new URL(row[key]);assert.equal(url.protocol,'https:');assert.equal(url.username+url.password,'');}
 }
 assert(!/PSPath|PSParentPath|PSProvider|PSSnapIn|PSDrive|ReadCount|[A-Z]:\\\\Users\\\\/i.test(bytes),'Local machine metadata must not enter the client bundle.');
});
