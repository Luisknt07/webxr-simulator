'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {inspect}=require('./validate-glb.cjs'),profiles=require('./profiles.json');
const {LIMITS}=require('./glb-resources.cjs');
const {inspectPacket}=require('./validate-packet.cjs');
function build(options){
 const profile=profiles[options.profile||'quest'];assert(profile,'Unknown modeling profile.');
 const input=fs.realpathSync(options.input),output=path.resolve(options.output);assert(input!==output&&/\.glb$/i.test(output),'Use a distinct output.glb.');assert(!fs.existsSync(output),'Output exists; choose another path so source assets cannot be silently overwritten.');
 assert(fs.statSync(input).size<=LIMITS.bytes,'Source exceeds the bounded offline input size.');
 assert(!fs.existsSync(output+'.audit.json'),'Choose a new audit destination; existing reports are preserved.');
 const sourceBytes=fs.readFileSync(input);let before;
 if(/\.json$/i.test(input))before=inspectPacket(JSON.parse(sourceBytes.toString('utf8')));
 else before=inspect(sourceBytes);
 const blender=options.blender||process.env.STUDIO_BLENDER||'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';assert(fs.existsSync(blender),'Set STUDIO_BLENDER to the installed Blender executable.');
 const ratio=options.ratio===undefined?1:Number(options.ratio);assert(Number.isFinite(ratio)&&ratio>=.25&&ratio<=1);
 const blend=output.replace(/\.glb$/i,'.blend');if(options.saveBlend)assert(!fs.existsSync(blend),'Choose a new editable Blender destination.');
 const result=cp.spawnSync(blender,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',path.join(__dirname,'build-asset.py'),'--','--input',input,'--output',output,'--texture-edge',String(profile.textureEdge),'--lod-ratio',String(ratio),...(options.saveBlend?['--save-blend']:[])],{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
 if(result.error||result.status!==0)throw Error('Blender modeling failed: '+(result.error||result.stderr||result.stdout).toString().slice(-4000));
 const bytes=fs.readFileSync(output),after=inspect(bytes,profile);
 const sourceIds=new Set(before.components.map(x=>x.id).filter(Boolean)),outputIds=new Set(after.components.map(x=>x.id).filter(Boolean));for(const id of sourceIds)assert(outputIds.has(id),'Lost study component: '+id);
 const sourceJoints=new Set(before.components.map(x=>x.joint).filter(Boolean)),outputJoints=new Set(after.components.map(x=>x.joint).filter(Boolean));for(const id of sourceJoints)assert(outputJoints.has(id),'Lost actual joint identity: '+id);
 if(before.bounds&&ratio===1)for(const key of ['min','max'])for(let axis=0;axis<3;axis++)assert(Math.abs(before.bounds[key][axis]-after.bounds[key][axis])<.001,'Coordinate axes or envelope changed in Blender.');
 delete before.document;delete after.document;
 const report={version:1,profile:options.profile||'quest',input,output,editableBlend:options.saveBlend?blend:null,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),before,after,lodRatio:ratio,kinematicCompatibility:'Hierarchy and pivots retained. Run the machine motion tests before replacing an operational visual.',createdAt:new Date().toISOString()};
 fs.writeFileSync(output+'.audit.json',JSON.stringify(report,null,2));return report;
}
module.exports={build};if(require.main===module){try{const args=process.argv.slice(2),value=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};assert(value('--input')&&value('--output'),'Usage: node tooling/modeling/build.cjs --input equipment.glb --output equipment-web.glb [--profile quest|desktop] [--lod-ratio 0.65] [--save-blend]');console.log(JSON.stringify(build({input:value('--input'),output:value('--output'),profile:value('--profile'),ratio:value('--lod-ratio'),blender:value('--blender'),saveBlend:args.includes('--save-blend')}),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
