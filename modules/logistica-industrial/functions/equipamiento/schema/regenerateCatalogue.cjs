'use strict';
// Offline source projection. Runtime loads only catalogue-data.json, never the
// complete documents, embedded illustrations or an unreviewed title heuristic.
const fs=require('node:fs'),path=require('node:path'),crosswalk=require('./source-crosswalk.cjs');
function build(legacy,newBook){
 const sources=[...crosswalk.sourceRows(crosswalk.LEGACY_SOURCE,legacy.entries),...crosswalk.sourceRows(crosswalk.NEW_SOURCE,newBook.records)];
 if(sources.length!==387||new Set(sources.map(x=>x.key)).size!==387)throw new Error('Unexpected source inventory.');
 const definitions=new Map();
 sources.forEach(row=>{
  let d=definitions.get(row.canonicalId);if(!d){d={id:row.canonicalId,title:row.title,sourceRefs:[]};definitions.set(d.id,d);}
  d.sourceRefs.push({key:row.key,id:row.sourceId,namespace:row.namespace,title:row.title,familyId:row.familyId});
  if(row.namespace===crosswalk.NEW_SOURCE)d.title=row.title;
 });
 return {version:1,sourceNamespaces:[crosswalk.LEGACY_SOURCE,crosswalk.NEW_SOURCE],sources,definitions:[...definitions.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}
if(require.main===module){const root=path.resolve(__dirname,'../../..'),data=build(require(path.join(root,'documentation/index.cjs')),JSON.parse(fs.readFileSync(path.join(root,'practices/data/source-equipment.json'),'utf8')));fs.writeFileSync(path.join(__dirname,'catalogue-data.json'),JSON.stringify(data,null,2)+'\n');process.stdout.write(JSON.stringify({sources:data.sources.length,definitions:data.definitions.length})+'\n');}
module.exports={build};
