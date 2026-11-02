'use strict';
// Ten source practices, not one card per mode, case, stage or difficulty.
const source=require('./data/index.json');
const entries=source.records||source.entries;
if(!Array.isArray(entries)||entries.length!==10)throw Error('El índice configurable requiere diez prácticas de fuente.');
module.exports={version:2,format:'smarttwin.configurable-practices',namespace:'smarttwin-configurable-2026',entries,records:entries,source:source.sources||source.source,sources:source.sources||[],groups:[{id:'logistics',title:'CEDI · Logística'},{id:'industrial',title:'Smart Factory · Industrial'}]};
