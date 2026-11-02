'use strict';
const fs=require('node:fs'),path=require('node:path');
const {ApiError}=require('./validation');
// Optional sector adapter: removing the sector does not prevent API startup.
exports.createPracticeService=studio=>{
 const file=path.resolve(studio.frameworkModulesRoot||path.resolve(__dirname,'../../../modules'),'logistica-industrial/practices/server/PracticeProgressService.cjs');
 if(!fs.existsSync(file))return null;
 const Service=require(file);return new Service({db:studio.db,now:()=>studio.now(),error:(status,message,code)=>new ApiError(status,message,code)});
};
