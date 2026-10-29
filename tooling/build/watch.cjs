'use strict';
// Rebuild immutable applications. The API remains the only HTTP server.
const fs=require('node:fs'),path=require('node:path'),webpack=require('webpack');
const ROOT=path.resolve(__dirname,'../..'),configs=require('./webpack.config.cjs');
const {packageApps}=require('./package-apps.cjs');
const compiler=webpack(configs);
const watcher=compiler.watch({aggregateTimeout:400,ignored:[/node_modules/,/artifacts/,/data/]},(error,stats)=>{
 if(error){console.error(error.message);return;}
 if(stats.hasErrors()){console.error(stats.toString({all:false,errors:true}));return;}
 const directory=path.join(ROOT,'data/build');fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'webpack-stats.json'),JSON.stringify(stats.toJson({all:false,hash:true,name:true,assets:true,modules:true,nestedModules:true,errors:true,warnings:true,children:true,timings:true})));
 try{for(const item of packageApps())console.log(item.application+': '+item.manifest.bundleSha256);}catch(failure){console.error('Packaging failed: '+failure.message);}
});
const stop=()=>watcher.close(()=>compiler.close?compiler.close(()=>{}):undefined);
process.once('SIGINT',stop);process.once('SIGTERM',stop);
