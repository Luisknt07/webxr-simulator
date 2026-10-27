'use strict';
const assert=require('node:assert/strict'),THREE=require('three'),vehicles=require('../shared/vehicles'),prefabs=require('./load-vehicle-prefabs')(THREE);
const box=object=>new THREE.Box3().setFromObject(object),touch=(a,b)=>box(a).expandByScalar(.003).intersectsBox(box(b));
let stickerCount=0,mastPoseCount=0,lampPoseCount=0;
for(const definition of vehicles.VARIANTS){
  const object=prefabs.createVehicle(definition.preset),rig=object.userData.vehicleRig,c=rig.config;object.updateWorldMatrix(true,true);
  if(rig.cabin){
    rig.continuity.forEach(([a,b])=>{assert(a.parent&&b.parent,'Batches preserve structural node identities.');assert(touch(a,b),definition.id+' disconnected '+a.name+' / '+b.name);});
    const normal=new THREE.Vector3(0,0,1).applyQuaternion(rig.controls.wheel.restQuaternion);assert(normal.y>.7&&normal.z<-.3,'Steering rim tilts naturally above its connected column.');
  }
  if(rig.fenders)rig.fenders.forEach(fender=>{fender.geometry.computeBoundingBox();const local=fender.geometry.boundingBox.clone().applyMatrix4(fender.matrix);assert(local.min.y>=c.wheelRadius-.001,'Wheel arches cover the upper hemisphere, not an unattached side loop.');});
  if(rig.liftHydraulic)for(const lift of [0,c.maxLift*.5,c.maxLift]){
    prefabs.updateVehiclePose(object,Object.assign(vehicles.initialPose(c),{lift}));const h=rig.liftHydraulic;
    const a=new THREE.Vector3(0,-.5,0).applyMatrix4(h.piston.matrixWorld),b=new THREE.Vector3(0,.5,0).applyMatrix4(h.piston.matrixWorld),start=h.start.clone().applyMatrix4(rig.mast.matrixWorld),end=new THREE.Vector3(0,h.endY,.03).applyMatrix4(h.stage.matrixWorld);
    assert(a.distanceTo(start)<1e-8&&b.distanceTo(end)<1e-8,'Chrome piston continuously joins its fixed barrel and moving clevis at every lift.');
  }
  // Actual meshes retained across cosmetic batching form a continuous support
  // path: inner mast rails -> bridge -> clevis -> bearing -> axle -> sheave.
  // Exercise the reported0.72m pose and every lift/tilt/reach extremum; neither
  // the discs nor their mounts can keep an independent world transform.
  if(rig.mast){
    assert.equal(rig.mastPulleyMounts.length,2);assert.equal(rig.mastChains.length,2);
    for(const lift of [...new Set([0,Math.min(.72,c.maxLift),c.maxLift*.5,c.maxLift])])for(const tilt of [...new Set([-c.tiltLimit,0,c.tiltLimit])])for(const reach of [...new Set([0,c.maxReach])]){
      prefabs.updateVehiclePose(object,Object.assign(vehicles.initialPose(c),{lift,tilt,reach}));mastPoseCount++;
      rig.mastPulleyMounts.forEach(mount=>{
        const label=definition.id+' lift='+lift+' tilt='+tilt+' reach='+reach;
        for(const piece of [mount.pulley,mount.bearing,mount.bracket,mount.axle,mount.bridge,...mount.rails])assert(piece.parent,label+' structural part survives batching');
        assert.strictEqual(mount.frame,rig.mastStages[rig.mastStages.length-1].object);assert.strictEqual(mount.pulley.parent,mount.frame);
        assert(mount.rails.some(rail=>touch(rail,mount.bridge)),label+' bridge joins its telescopic rail');
        for(const [a,b]of [[mount.bridge,mount.bracket],[mount.bracket,mount.bearing],[mount.bearing,mount.axle],[mount.axle,mount.pulley]])assert(touch(a,b),label+' disconnected '+a.name+' / '+b.name);
        assert(mount.pulley.getWorldPosition(new THREE.Vector3()).distanceTo(mount.center.clone().applyMatrix4(mount.frame.matrixWorld))<1e-9,label+' sheave shares its actual moving crosshead');
        mount.axle.geometry.computeBoundingBox();const bb=mount.axle.geometry.boundingBox,line=new THREE.Line3(new THREE.Vector3(0,bb.min.y,0).applyMatrix4(mount.axle.matrixWorld),new THREE.Vector3(0,bb.max.y,0).applyMatrix4(mount.axle.matrixWorld));
        const center=mount.pulley.getWorldPosition(new THREE.Vector3());assert(line.closestPointToPoint(center,true,new THREE.Vector3()).distanceTo(center)<1e-8,label+' axle passes through pulley centre');
        const localBounds=mount.pulley.geometry.boundingBox||((mount.pulley.geometry.computeBoundingBox()),mount.pulley.geometry.boundingBox),top=localBounds.clone().applyMatrix4(mount.pulley.matrix).max.y;
        assert(top<Math.max(.6,c.mastHeight),label+' pulley does not project above the stage envelope');
      });
      rig.mastChains.forEach(chain=>{
        assert(touch(chain.carriagePlate,chain.carriageAnchor));assert(touch(chain.lowerBridge,chain.returnAnchor));
        chain.returnAnchor.geometry.computeBoundingBox();const forkInverse=new THREE.Matrix4().getInverse(rig.forks.matrixWorld),returnBounds=chain.returnAnchor.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(forkInverse,chain.returnAnchor.matrixWorld));assert(returnBounds.max.z<.075,definition.id+' chain return bracket stays behind the actual pallet rear-clearance plane across lift/tilt/reach.');
        const matrix=new THREE.Matrix4();
        for(const run of [0,1]){
          chain.object.getMatrixAt(run*chain.count*2,matrix);const first=chain.object.geometry.boundingBox||((chain.object.geometry.computeBoundingBox()),chain.object.geometry.boundingBox),bounds=first.clone().applyMatrix4(matrix).applyMatrix4(chain.object.matrixWorld);
          const anchor=run?chain.returnAnchor:chain.carriageAnchor;assert(bounds.clone().expandByScalar(.003).intersectsBox(box(anchor)),definition.id+' chain terminates on its real anchor');
        }
        chain.object.getMatrixAt(chain.count*2-1,matrix);assert(matrix.elements[13]<chain.pulley.position.y,'Chain plates stop at the sheave; no plate floats beyond its crosshead.');
      });
    }
  }
  if(rig.cabin){
    assert.equal(rig.cabLampMounts.length,2);
    for(const lift of [0,Math.min(.72,c.maxLift),c.maxLift])for(const tilt of [...new Set([-c.tiltLimit,0,c.tiltLimit])]){
      prefabs.updateVehiclePose(object,Object.assign(vehicles.initialPose(c),{lift,tilt}));lampPoseCount++;
      rig.cabLampMounts.forEach(({post,mount,housing,lens})=>{
        assert.strictEqual(mount.parent,post);assert.strictEqual(housing.parent,post);assert.strictEqual(lens.parent,post);
        for(const [a,b]of [[post,mount],[mount,housing],[housing,lens]])assert(touch(a,b),definition.id+' work light has a physical support: '+a.name+' / '+b.name);
        const inPost=new THREE.Vector3().copy(lens.getWorldPosition(new THREE.Vector3())).applyMatrix4(new THREE.Matrix4().getInverse(post.matrixWorld));assert(inPost.distanceTo(lens.position)<1e-9,'Lamp follows the actual inclined pillar, including an elevating cab.');
      });
    }
  }
  if(rig.boomHydraulic)for(const angle of [0,c.boomAngleLimit*.5,c.boomAngleLimit]){
    prefabs.updateVehiclePose(object,Object.assign(vehicles.initialPose(c),{boomAngle:angle}));const h=rig.boomHydraulic,upper=h.upper.getWorldPosition(new THREE.Vector3()),end=new THREE.Vector3(0,.5,0).applyMatrix4(h.rod.matrixWorld);assert(upper.distanceTo(end)<1e-8,'Telescopic boom ram stays connected to its moving pin.');assert(touch(h.barrel,h.rod));
  }
  prefabs.updateVehiclePose(object,vehicles.initialPose(c));
  const colliders=[];object.traverse(node=>{if(node.isMesh&&!node.userData.vehicleDecal&&!node.material.transparent)colliders.push(node);});
  object.traverse(node=>{
    if(!node.userData.vehicleDecal)return;stickerCount++;const texture=node.material.map,uv=node.geometry.attributes.uv;
    assert.equal(texture.flipY,false);let u=0,v=0;for(let i=0;i<uv.count;i++){u+=uv.getX(i)/uv.count;v+=uv.getY(i)/uv.count;}
    const pixel=(Math.min(255,Math.floor(v*256))*512+Math.min(511,Math.floor(u*512)))*4;assert.equal(texture.image.data[pixel+3],255,'Each atlas rectangle samples actual printed texels.');
    const center=node.getWorldPosition(new THREE.Vector3()),normal=new THREE.Vector3(0,0,1).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion())),ray=new THREE.Raycaster(center.clone().addScaledVector(normal,.03),normal.clone().negate(),0,.08),host=node.userData.vehicleDecalHost,hits=host?ray.intersectObject(host,false):ray.intersectObjects(colliders,false);
    assert(hits.length,definition.id+' floating sticker '+node.name);assert(hits[0].distance>=.0295&&hits[0].distance<=.039,definition.id+' sticker inside or too far from host '+node.name+' '+hits[0].distance);
  });
}
// Batch geometry retains full TRS and precomposed matrices. The old unconditional
// updateMatrix discarded authored manual matrices before merging them.
const owner=prefabs.createVehicle(),b=owner.userData.vehicleRig.resources,d=owner.userData.vehicleRig.detail,root=new THREE.Group();root.position.set(1,2,3);root.rotation.set(.2,.3,.4);root.scale.set(1.2,.8,.9);
for(let i=0;i<5;i++){const mesh=b.box('TRS '+i,[.12,.08,.10],'steel',root,[i*.13,.2,.3]);mesh.rotation.set(i*.15,.1,.3);mesh.scale.set(1+i*.1,1,.8);if(i===4){mesh.matrixAutoUpdate=false;mesh.matrix.compose(new THREE.Vector3(.9,.4,.5),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.7),new THREE.Vector3(.8,1.1,.9));}}
const vertices=parent=>{parent.updateWorldMatrix(true,true);const result=[];parent.traverse(node=>{if(!node.geometry)return;const p=node.geometry.attributes.position,index=node.geometry.index,count=index?index.count:p.count;for(let i=0;i<count;i++)result.push(new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(node.matrixWorld).toArray().map(value=>value.toFixed(6)).join(','));});return result.sort();};
const before=vertices(root);d.batch(root);assert.deepEqual(vertices(root),before);assert.equal(root.children.length,1);
// Pallet-truck load rollers form a connected rocker linkage at the fork toe.
// They remain on the floor while the fixed-length links support the lifting
// tines, rather than passing through the pallet's rear bottom board.
for(const variant of ['pallet-truck-manual','pallet-truck-electric']){
  const truck=prefabs.createVehicle(vehicles.defaults(variant)),rig=truck.userData.vehicleRig,c=rig.config;assert.equal(rig.loadRollers.length,2);
  for(const lift of [0,c.maxLift*.25,c.maxLift*.5,c.maxLift*.75,c.maxLift]){
    prefabs.updateVehiclePose(truck,{lift,wheelRoll:.6});const tool=rig.forks.getWorldPosition(new THREE.Vector3());assert(Math.abs(tool.y-c.forkBaseHeight-lift)<1e-8);assert(Math.abs(tool.z-c.length/2)<1e-8,'Roller correction preserves the fork TCP.');
    rig.loadRollers.forEach(roller=>{
      const wheelBounds=new THREE.Box3(),positions=roller.wheel.geometry.attributes.position;for(let i=0;i<positions.count;i++)wheelBounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(roller.wheel.matrixWorld));assert(wheelBounds.min.y>=-.001&&wheelBounds.min.y<.004,'A ground-contact load roller neither floats nor sinks while lifting.');
      if(!lift)assert(wheelBounds.min.z>c.length/2+.48+.47+.005,'The roller clears the rear bottom board of the industrial1m and Euro.8m pallets at the actual pickup centre.');
      assert(touch(roller.wheel,roller.axle));assert(touch(roller.pin,rig.forks));
      roller.links.forEach(link=>{assert.strictEqual(link.object.parent,rig.forks);const a=new THREE.Vector3(0,-.5,0).applyMatrix4(link.object.matrixWorld),b=new THREE.Vector3(0,.5,0).applyMatrix4(link.object.matrixWorld);assert(Math.abs(a.distanceTo(b)-roller.linkLength)<1e-8,'The support rocker has a fixed physical length.');assert(a.distanceTo(new THREE.Vector3(link.x,-c.forkThickness+.012,roller.pivotZ).applyMatrix4(rig.forks.matrixWorld))<1e-8);assert(Math.abs(b.y-roller.radius)<1e-8);assert(Math.abs(b.z-roller.axle.position.z)<1e-8);assert(touch(link.object,roller.pin)&&touch(link.object,roller.axle),'Every support link joins its actual upper pin and lower axle.');});
    });
  }
}
console.log('Vehicle continuity: all13 variants, '+mastPoseCount+' lift/tilt/reach mast poses with supported sheaves and chain anchors, '+lampPoseCount+' cab-light poses, joined seat/column/consoles, hydraulic endpoints, '+stickerCount+' mounted labels and lossless full-TRS batching passed.');
