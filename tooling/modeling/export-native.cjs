'use strict';
// Bundle the actual application factories. No second machine/template recipe.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),webpack=require('webpack');
const ROOT=path.resolve(__dirname,'../..');
async function exportNative({kind='vehicle',variant='forklift-electric-4w',output}){
 const destination=path.resolve(output);assert(!fs.existsSync(destination),'Choose a new packet output path.');
 const temp=path.join(ROOT,'data/qa-studio/native-modeling');fs.mkdirSync(temp,{recursive:true});
 await new Promise((resolve,reject)=>webpack({mode:'development',target:'node',devtool:false,entry:path.join(__dirname,'native-entry.js'),output:{path:temp,filename:'native-factories.cjs',libraryTarget:'commonjs2',hashFunction:'sha256'},externals:{three:'commonjs three'},optimization:{minimize:false}},(error,stats)=>{if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();}));
 const api=require(path.join(temp,'native-factories.cjs')),object=api.createIndustrialPrefab(kind,variant),packet=api.equipmentPacket(object);
 assert(packet.format==='smarttwin.native-equipment'&&packet.nodes.length>0);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(packet));return {output:destination,kind,variant,counts:packet.counts};
}
module.exports={exportNative};if(require.main===module){const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];if(!args.includes('--output')){console.error('Usage: node --openssl-legacy-provider tooling/modeling/export-native.cjs --kind vehicle --variant forklift-electric-4w --output new-machine.json');process.exitCode=1;}else exportNative({kind:args.includes('--kind')?get('--kind'):'vehicle',variant:args.includes('--variant')?get('--variant'):'forklift-electric-4w',output:get('--output')}).then(r=>console.log(JSON.stringify(r))).catch(error=>{console.error(error);process.exitCode=1;});}
