'use strict';
// Single byte ranges for manifest-verified tutorial media. Authentication and
// artifact integrity are checked by the caller before this helper is reached.
function mediaRange(header,size){
 if(!Number.isSafeInteger(size)||size<=0)return null;
 if(typeof header!=='string'||header.length>128)return null;
 const match=/^bytes=(\d*)-(\d*)$/.exec(header.trim());
 if(!match||(!match[1]&&!match[2]))return null;
 const first=match[1]?Number(match[1]):null,last=match[2]?Number(match[2]):null;
 if((first!==null&&!Number.isSafeInteger(first))||(last!==null&&!Number.isSafeInteger(last)))return null;
 if(first===null){if(last<=0)return null;return{start:Math.max(0,size-last),end:size-1};}
 if(first>=size||last!==null&&last<first)return null;
 return{start:first,end:last===null?size-1:Math.min(last,size-1)};
}
module.exports={mediaRange};
