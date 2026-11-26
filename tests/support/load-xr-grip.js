const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = THREE => {
 const poseSource=fs.readFileSync(path.resolve(__dirname,'../../packages/render-three/src/XRHandPose.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class XRHandPose','class XRHandPose').replace(/^export /gm,'');
 const XRHandPose=new Function('THREE',poseSource+'\nreturn XRHandPose;')(THREE);
 const root=path.resolve(__dirname,'../..'),source=fs.readFileSync(path.join(root,'packages/render-three/src/XRHandMesh.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class XRHandMesh','return class XRHandMesh');
 const XRHandMesh=new Function('THREE','handMeshes','XRHandPose',source)(THREE,require('../../packages/render-three/src/hand-meshes.json'),XRHandPose);
 return new Function('THREE','XRHandMesh', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-xr-grip.js"), '../src/lib/XRGripTracking.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nreturn {createXRGrip,updateXRGrip,disposeXRGrip};')(THREE,XRHandMesh);
};
