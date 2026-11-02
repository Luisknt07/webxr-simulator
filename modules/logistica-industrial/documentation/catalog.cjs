'use strict';
// Full source-derived content: load only when documentation is requested.
const data=require('./catalog-data.json');
module.exports=Object.assign(data,{SOURCE:data.source,FAMILIES:data.families,CHAPTERS:data.chapters,ARTICLES:data.articles,OPERATIONS:data.operations});
