'use strict';
// Local administration only. No network listener and no password in argv.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),{Writable}=require('node:stream');
const {createApiHandler}=require("./server/api.js");
async function bootstrapOwner(options){
 const api=createApiHandler({dataDir:options.dataDir,maintenanceIntervalMs:0});
 try{return await api.studio.bootstrapOwner(options);}finally{api.close();}
}
async function password(){
 if(process.env.SMARTTWIN_BOOTSTRAP_PASSWORD){const value=process.env.SMARTTWIN_BOOTSTRAP_PASSWORD;delete process.env.SMARTTWIN_BOOTSTRAP_PASSWORD;return value;}
 if(!process.stdin.isTTY)return fs.readFileSync(0,'utf8').replace(/\r?\n$/,'');
 const mute=new Writable({write(chunk,encoding,done){done();}}),input=readline.createInterface({input:process.stdin,output:mute,terminal:true,historySize:0});
 process.stdout.write('Contraseña del administrador: ');
 try{return await new Promise((resolve,reject)=>{input.once('SIGINT',()=>reject(new Error('Configuración cancelada.')));input.question('',resolve);});}finally{input.close();process.stdout.write('\n');}
}
async function main(){
 const args=process.argv.slice(2);if(args.shift()!=='bootstrap')throw Error('Uso: node apps/api/admin.cjs bootstrap --username USUARIO [--data-dir RUTA] [--display-name NOMBRE] [--open-registration]. Contraseña por entrada estándar o solicitud oculta.');
 const options={dataDir:path.resolve(process.env.SMARTTWIN_DATA_DIR||path.join(__dirname,'../../data')),invitationOnly:true};
 while(args.length){const key=args.shift();if(key==='--open-registration'){options.invitationOnly=false;continue;}if(!['--username','--data-dir','--display-name'].includes(key)||!args.length)throw Error('Opción de administración inválida.');const value=args.shift();if(key==='--username')options.username=value;else if(key==='--data-dir')options.dataDir=path.resolve(value);else options.displayName=value;}
 if(!options.username)throw Error('Falta --username.');options.password=await password();await bootstrapOwner(options);options.password='';console.log('Administrador configurado. Puede iniciar sesión.');
}
module.exports={bootstrapOwner,main};if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
