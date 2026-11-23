const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = THREE => {
 const root=path.resolve(__dirname,'../..'),source=fs.readFileSync(path.join(root,'packages/render-three/src/XRHandMesh.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class XRHandMesh','return class XRHandMesh');
 const XRHandMesh=new Function('THREE','handMeshes',source)(THREE,require('../../packages/render-three/src/hand-meshes.json'));
 return new Function('THREE','XRHandMesh', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-xr-grip.js"), '../src/lib/XRGripTracking.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nreturn {createXRGrip,updateXRGrip,disposeXRGrip};')(THREE,XRHandMesh);
};
