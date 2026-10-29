const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-processor-runtime'), {THREE, behaviorSchema, setup, add, record, vars, advance} = h;
const source = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-smooth-grade-support.js"), '..', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const Assembly = new Function('THREE', 'conveyorLayout', source("modules/logistica-industrial/functions/bandas/runtime/ConveyorAssembly.js").replace('default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, behaviorSchema.conveyorLayout);
function link(f, from, to) {
  const assembly = new Assembly({document: f.document, roomId: 'hall'}), config = assembly.config(from);
  f.document.setBehaviors(from, [Object.assign({}, config, {outputId: to.userData.editorId}, config.type === 'conveyor' ? {} : {delivery: 'automatic'})]); assembly.align(from, 'output', to, 'input');
}
function tangentPose(f, rec, belt, offset, item) {
  const point = f.runtime.pathPoint(belt.config, offset + f.runtime.pathLength(belt.config) / 2), up = f.runtime.pathUp(rec);
  const forward = f.runtime.pathVector(rec, point.tx, point.tz, point.ty || 0).normalize(), right = forward.clone().cross(up).normalize(), normal = right.clone().cross(forward).normalize();
  const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, normal, right));
  if (item.orientationOffset) orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), item.orientationOffset));
  const center = item.bounds.getCenter(new THREE.Vector3()).multiply(item.scale), world = f.runtime.pathSurface(rec, belt, point).addScaledVector(normal, -item.bounds.min.y * item.scale.y + .005).sub(new THREE.Vector3(center.x, 0, center.z).applyQuaternion(orientation));
  return new THREE.Matrix4().compose(world, orientation, item.scale);
}
function supportGap(f, rec, belt, matrix, item) {
  const normal = new THREE.Vector3().setFromMatrixColumn(matrix, 1).normalize(), inverse = new THREE.Matrix4().getInverse(rec.object.matrixWorld), length = f.runtime.pathLength(belt.config);
  const bottom = item.bounds.getCenter(new THREE.Vector3()); bottom.y = item.bounds.min.y; bottom.applyMatrix4(matrix);
  let min = Infinity, max = -Infinity;
  for (const x of [item.bounds.min.x, item.bounds.max.x]) for (const z of [item.bounds.min.z,item.bounds.max.z]) {
    const corner = new THREE.Vector3(x,item.bounds.min.y,z).applyMatrix4(matrix).applyMatrix4(inverse), s = (belt.config.axis === 'z' ? corner.z : corner.x) + length / 2;
    min = Math.min(min,s); max = Math.max(max,s);
  }
  let gap = Infinity;
  for (let sample=0; sample<=512; sample++) {
    const surface = f.runtime.pathSurface(rec,belt,f.runtime.pathPoint(belt.config,min+(max-min)*sample/512)); gap = Math.min(gap,bottom.clone().sub(surface).dot(normal));
  }
  return gap;
}
async function run() {
  for (const rise of [.2,-.2]) for (const axis of ['x','z']) {
    const f=setup(), conveyor=add(f,'conveyor',{length:1.4,rise,gradeProfile:'smooth',axis});
    conveyor.rotation.set(.12,.8,-.07); conveyor.scale.set(1.3,.9,1.1); f.scene.updateMatrixWorld(true); f.runtime.start('hall');
    const rec=record(f,conveyor), belt=rec.components.conveyor;
    for (const width of [.25,.45,.9,1.2]) for (const yaw of [0,.4,Math.PI/2]) {
      const item={bounds:new THREE.Box3(new THREE.Vector3(-width/2,-.1,-.3),new THREE.Vector3(width/2,.6,.3)),scale:new THREE.Vector3(1,.9,1.1),orientationOffset:yaw};
      for (let offset=-.9;offset<=.9;offset+=.075) {
        const matrix=f.runtime.packageMatrix(rec,belt,offset,item), tangent=tangentPose(f,rec,belt,offset,item);
        assert(supportGap(f,rec,belt,matrix,item)>=.005-1e-7,'The whole rigid lower plane clears the exact cubic profile and both flat interfaces.');
        const position=new THREE.Vector3().setFromMatrixPosition(matrix), original=new THREE.Vector3().setFromMatrixPosition(tangent), correction=position.sub(original), up=f.runtime.pathUp(rec);
        assert(correction.dot(up)>=-1e-10); assert(correction.clone().cross(up).length()<1e-9,'Correction only lifts vertically; no invented forward motion or rotation.');
        for(let col=0;col<3;col++) for(let row=0;row<3;row++) h.close(matrix.elements[col*4+row],tangent.elements[col*4+row]);
        if(correction.length()>1e-8) assert(supportGap(f,rec,belt,matrix,item)<.005001,'Analytic extrema give the minimum supported lift, not a fixed clearance padding.');
      }
    }
    for(const values of [{gradeProfile:'linear',rise:.2},{gradeProfile:'smooth',rise:0}]) {
      Object.assign(belt.config,values); const item={bounds:new THREE.Box3(new THREE.Vector3(-.225,0,-.15),new THREE.Vector3(.225,.35,.15)),scale:new THREE.Vector3(1,1,1)};
      for(const offset of [-.7,0,.7]) assert.deepEqual(f.runtime.packageMatrix(rec,belt,offset,item).toArray(),tangentPose(f,rec,belt,offset,item).toArray(),'Legacy linear and flat paths retain their exact pose arithmetic.');
    }
    f.runtime.stop();
  }
  {
    const f=setup(), supply=add(f,'source',{autoGenerate:true,interval:2,outputInterval:.1,capacity:2,totalLimit:20,width:.45,height:.35,depth:.3,mass:4});
    const feed=add(f,'conveyor',{equipmentId:'belt-incline',surface:'belt',length:1.4,rise:.2,gradeProfile:'smooth',speed:.55,maxLoad:150});
    const gravity=add(f,'conveyor',{equipmentId:'roller-gravity',drive:'gravity',powered:false,length:4,rise:-.2,gradeProfile:'smooth',supportHeight:1.2,rollingResistance:.005,rollerPitch:.1,maxLoad:150});
    const sink=add(f,'palletQueue',{withPanel:false,layoutMode:'fit',palletType:'euro-1200x800',palletCapacity:4,layers:5,capacity:128,maxStackHeight:1.8,autoRelease:true,releaseInterval:.1});
    link(f,supply,feed);link(f,feed,gravity);link(f,gravity,sink); f.runtime.start('hall');
    assert(f.runtime.sourceRuntime.generate(record(f,supply)));
    const product=record(f,supply).components.source.queue[0].product, item=product.item, feedRecord=record(f,feed), feedBelt=feedRecord.components.conveyor;
    const options=f.runtime.packageCollisionOptions(feedRecord,item); options.ignore.push(product.object);
    const offset=-.64500972+.01, prior=tangentPose(f,feedRecord,feedBelt,offset,item), corrected=f.runtime.packageMatrix(feedRecord,feedBelt,offset,item);
    f.scene.updateMatrixWorld(true);f.ctx.collisionWorld.beginFrame();
    assert(f.ctx.collisionWorld.testBox(product.bounds.clone().applyMatrix4(prior),options),'Sensitivity: the old centre tangent really intersects the Source deck for the reported .45 m carton.');
    assert(!f.ctx.collisionWorld.testBox(product.bounds.clone().applyMatrix4(corrected),options),'The geometric support correction clears the same real collider without ignoring Source.');
    f.ctx.collisionWorld.endFrame();
    advance(f,60);
    assert.equal(vars(f,supply).generated,20);assert.equal(vars(f,sink).receivedUnits,20,'The original short smooth incline feeds gravity through actual Source geometry, without hiding its deck or reducing box size.');
    assert.equal(record(f,gravity).components.conveyor.powered,false); f.runtime.stop();
  }
  console.log('Smooth rigid-load support: analytic cubic/flat-interface clearance, exact minimum vertical lift, rotated/scaled footprints, unchanged linear/flat paths and real Source-to-short-incline-to-unpowered-gravity flow passed.');
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
