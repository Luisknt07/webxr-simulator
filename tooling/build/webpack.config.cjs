'use strict';
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const rules=[{test:/[\\/]three[\\/]build[\\/]three(?:\.module)?\.js$/,use:{loader:path.join(__dirname,'loaders/three-r112-instancing.js')}},{test:/\.(js|mjs)$/,exclude:/node_modules/,use:{loader:'babel-loader',options:{babelrc:false,configFile:false,parserOpts:{plugins:['dynamicImport','objectRestSpread','classProperties']}}}}];
function application(name,entry,file){return {name,mode:'production',context:ROOT,entry:path.join(ROOT,entry),output:{filename:file,path:path.join(ROOT,'artifacts',name),publicPath:'',globalObject:'self'},devtool:false,module:{rules},resolve:{extensions:['.mjs','.js','.json'],alias:{'three$':path.join(ROOT,'node_modules/three/build/three.module.js')}},optimization:{splitChunks:false,runtimeChunk:false},performance:{hints:'warning'}};}
const publicViewer=application('public-viewer','apps/public-viewer/main.js','viewer.js');
const workspace=application('workspace','apps/workspace/src/index.js','bundle.js');
const empty=application('core-empty','apps/core-empty/browser.js','core-empty.js');
const workers={name:'geometry-workers',mode:'production',context:ROOT,target:'webworker',entry:{'mesh-optimizer-worker':'./packages/render-three/workers/MeshOptimizerWorker.js','collision-worker':'./packages/render-three/workers/CollisionWorker.js','cad-worker':'./packages/tools/cad/workers/CADWorker.js'},output:{filename:'[name].js',path:path.join(ROOT,'artifacts/workspace'),globalObject:'self'},devtool:false,module:{rules},resolve:{alias:{'three$':path.join(ROOT,'node_modules/three/build/three.module.js')}}};
module.exports=[publicViewer,workspace,empty,workers];
