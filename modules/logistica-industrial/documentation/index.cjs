'use strict';
// Lightweight taxonomy only. Never import the full wiki or its images here.
const data=require('./index-data.json');
module.exports=Object.assign(data,{SOURCE:data.source,FAMILIES:data.families,CHAPTERS:data.chapters,ENTRIES:data.entries});
