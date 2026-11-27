'use strict';
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),THREE=require('three'),schema=require('../../modules/logistica-industrial/contracts/behaviors.js');
const file=path.resolve(__dirname,'../legacy/test-conveyor-mechanisms.js'),source=fs.readFileSync(file,'utf8');
const {setup}=new Function('require','__dirname',source.slice(0,source.indexOf('async function run()'))+'\nreturn {setup};')(createRequire(file),path.dirname(file));
module.exports=function(){
 const f=setup(),study=require('./load-study-scenes.js')(THREE,schema,f.document.constructor);study.studySceneBase(f.document,'hall');
 const base=study.buildStudyScene(f.document,'hall','vr-robot-transfer',{scene:f.scene,publicDemo:true}),built=require('../../projects/smarttwin/PublicDemoScene.cjs').buildPublicDemoScene({THREE,schema,document:f.document,roomId:'hall',scene:f.scene,base,ConveyorAssembly:study.ConveyorAssembly});
 f.runtime.vehicleRuntime=new (require('./load-vehicle-runtime.js')(THREE))(f.runtime);f.scene.updateMatrixWorld(true);f.runtime.start('hall');require('../../projects/smarttwin/PublicDemoStock.cjs')(THREE,f.runtime);
 return{...f,THREE,schema,built,record:object=>f.runtime.records.get(object.userData.editorId),tick(seconds){for(let i=0;i<seconds*30;i++){f.scene.updateMatrixWorld(true);f.runtime.execute(1/30);}},close(){f.runtime.stop();}};
};
