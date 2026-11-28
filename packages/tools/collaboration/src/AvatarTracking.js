import * as THREE from 'three';

// Fixed wire order: never send arbitrary keys, matrices or unbounded joint sets.
export const HAND_JOINTS=['wrist','thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip',...['index','middle','ring','pinky'].reduce((all,f)=>all.concat(['metacarpal','phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'].map(p=>f+'-finger-'+p)),[])];
export const BODY_JOINTS=['hips','spine-lower','spine-middle','spine-upper','chest','neck','head',...['left','right'].reduce((all,s)=>all.concat(['shoulder','arm-upper','arm-lower','hand-wrist','upper-leg','lower-leg','foot-ankle','foot-ball'].map(j=>s+'-'+j)),[])];
const round=n=>Math.round(n*10000)/10000;
const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(),matrix=new THREE.Matrix4();
export function validPose(value){
 if(!value||!Array.isArray(value.position)||value.position.length!==3||value.position.some(n=>!Number.isFinite(n)||Math.abs(n)>10000)||!Array.isArray(value.quaternion)||value.quaternion.length!==4||value.quaternion.some(n=>!Number.isFinite(n)))return false;
 const length=Math.hypot(...value.quaternion);return length>.99&&length<1.01;
}
function validRow(row,size=7){return Array.isArray(row)&&row.length===size&&row.every(Number.isFinite)&&row.slice(0,3).every(n=>Math.abs(n)<10000)&&Math.abs(Math.hypot(...row.slice(3,7))-1)<.01;}
export function validPresence(pose){
 if(!validPose(pose)||pose.mode!==undefined&&!['desktop','vr'].includes(pose.mode))return false;
 const near=(a,b,r)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<=r;
 for(const side of ['left','right']){const hand=pose[side];if(!hand)continue;if(!validPose(hand)||!near(hand.position,pose.position,3.5))return false;if(hand.joints!==undefined&&(!['tracked','controller'].includes(hand.source)||!Array.isArray(hand.joints)||hand.joints.length!==25||!hand.joints.every(row=>validRow(row)&&near(row,hand.position,.5))))return false;}
 if(pose.body!==undefined&&pose.body!==null){const body=pose.body;if(body.source!=='device-body'||!Array.isArray(body.joints)||body.joints.length!==BODY_JOINTS.length||!body.joints.every(row=>row===null||validRow(row,8)&&[0,1,2].includes(row[7])&&near(row,pose.position,3.5)))return false;}
 return true;
}
function worldPose(object){object.updateWorldMatrix(true,false);return{position:object.getWorldPosition(position).toArray().map(round),quaternion:object.getWorldQuaternion(quaternion).toArray().map(round)};}
function visible(object){for(let n=object;n;n=n.parent)if(!n.visible)return false;return true;}
function rowFromMatrix(value){value.decompose(position,quaternion,scale);return position.toArray().concat(quaternion.normalize().toArray()).map(round);}

/** Called only inside an active XR animation frame. An optional body API never
 * gates controllers. Inferred/unknown body data stays explicitly labelled. */
export function captureXRBody(ctx,frame){
 ctx.xrBodyPacket=null;
 if(!ctx.vrMode||!frame||!ctx.renderer||!ctx.renderer.xr)return;
 const reference=ctx.renderer.xr.getReferenceSpace&&ctx.renderer.xr.getReferenceSpace();
 let body;try{body=frame.body;}catch(_){return;}if(!body||!reference||!frame.getPose)return;
 const rig=ctx.cameraRig;if(rig)rig.updateWorldMatrix(true,false);
 const joints=BODY_JOINTS.map(name=>{try{const space=body.get?body.get(name):body[name],pose=space&&frame.getPose(space,reference),values=pose&&pose.transform&&pose.transform.matrix;if(!values||values.length!==16||!Array.from(values).every(Number.isFinite))return null;matrix.fromArray(values);if(rig)matrix.premultiply(rig.matrixWorld);const row=rowFromMatrix(matrix);row.push(pose.emulatedPosition===false?0:pose.emulatedPosition===true?1:2);return row;}catch(_){return null;}});
 if(joints.some(Boolean))ctx.xrBodyPacket={source:'device-body',joints};
}

/** Captures the exact same skinned hand joints used locally, including fingers.
 * Hand tracking does not require gripSpace. Controller fingers are labelled as
 * animated, not measured. No avatar IK feeds back into device input. */
export function capturePresence(ctx){
 const xr=ctx.renderer&&ctx.renderer.xr,camera=xr&&xr.isPresenting?xr.getCamera(ctx.camera):ctx.camera;if(!camera)return null;
 // r112's ArrayCamera has an authoritative XR matrixWorld. Rebuilding it from
 // local position/quaternion can overwrite the current headset measurement.
 let result;if(xr&&xr.isPresenting){const row=rowFromMatrix(camera.matrixWorld);result={position:row.slice(0,3),quaternion:row.slice(3,7)};}else result=worldPose(camera);
 result.mode=ctx.vrMode?'vr':'desktop';result.seated=!!ctx.drivingVehicle;const session=xr&&xr.getSession&&xr.getSession();result.active=ctx.vrMode?!(session&&session.visibilityState&&session.visibilityState!=='visible'):!(typeof document!=='undefined'&&document.hidden);if(!result.active)return result;
 if(ctx.vrMode)for(const data of ctx.raycontrol&&ctx.raycontrol.controllers||[]){
  const side=data.inputSource&&data.inputSource.handedness;if(!['left','right'].includes(side))continue;
  const skin=data.grip&&data.grip.xrInputVisual&&data.grip.xrInputVisual.skin;
  if(skin&&visible(skin.root)&&HAND_JOINTS.every(name=>skin.bones.has(name))){
   skin.root.updateWorldMatrix(true,true);const wrist=skin.bones.get('wrist'),hand=worldPose(wrist);hand.source=skin.mode==='tracked'?'tracked':'controller';hand.joints=HAND_JOINTS.map(name=>{const b=skin.bones.get(name);return rowFromMatrix(b.matrixWorld);});result[side]=hand;
  }else if(!skin&&data.grip&&visible(data.grip))result[side]=worldPose(data.grip);
 }
 if(ctx.vrMode&&ctx.xrBodyPacket)result.body=ctx.xrBodyPacket;return result;
}
