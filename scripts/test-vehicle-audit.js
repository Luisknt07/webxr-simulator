'use strict';
// Adversarial operational regressions on the real vehicle/runtime/geometry.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const h=require('./test-vehicle-runtime.js'),{fixture,step,THREE,prefabs,vehicles}=h;
const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);

// Refused pickup must never register phantom inventory or mutate hydraulic pose.
const limited=fixture('forklift-electric-4w',false,true),limitedProduct=limited.runtime.products.get(limited.pallet);
limited.v.config.maxLift=.005;const pose=Object.assign({},limited.v.pose),forks=limited.api.rig(limited.record).forks,matrix=forks.matrixWorld.clone(),entries=limited.runtime.sourceRuntime.entries.size;
assert.equal(limited.api.pickup(limited.record),false);assert.deepEqual(limited.v.pose,pose);assert(forks.matrixWorld.equals(matrix));assert.equal(limitedProduct.sourceEntry,undefined);assert.equal(limited.runtime.sourceRuntime.entries.size,entries);limited.runtime.stop();

// A real obstruction encountered while engaging is checked before ownership.
const obstructed=fixture(),obstructedProduct=obstructed.runtime.products.get(obstructed.pallet),mast=obstructed.api.rig(obstructed.record).mast;
const obstacle=new THREE.Mesh(new THREE.BoxBufferGeometry(.08,.006,.04),new THREE.MeshBasicMaterial());obstacle.position.set(0,obstructed.config.mastHeight+.011,0).applyMatrix4(mast.matrixWorld);obstructed.root.add(obstacle);obstructed.ctx.collisionWorld.invalidate(obstacle);
const beforePose=Object.assign({},obstructed.v.pose);assert.equal(obstructed.api.pickup(obstructed.record),false,obstructed.v.warning);assert.deepEqual(obstructed.v.pose,beforePose);assert.equal(obstructedProduct.sourceEntry,undefined);assert.equal(obstructed.v.entry,null);obstructed.runtime.stop();

// Paused/emergency vehicles cannot silently transfer existing custody.
const held=fixture('forklift-electric-4w',false,true);assert(held.api.pickup(held.record),held.v.warning);const entry=held.v.entry,cargo=entry.product,heldMatrix=cargo.object.matrixWorld.clone();
held.api.command(held.record,'pause');assert.equal(held.api.release(held.record),false);assert.equal(held.v.entry,entry);assert(cargo.object.matrixWorld.equals(heldMatrix));
held.api.command(held.record,'emergency');assert.equal(held.api.release(held.record),false);assert.equal(cargo.vehicleOwnerId,held.record.id);held.api.command(held.record,'resetEmergency');assert.equal(held.api.release(held.record),false);held.api.command(held.record,'start');assert(held.api.release(held.record),held.v.warning);assert.equal(cargo.sourceEntry,entry);held.runtime.stop();

// Partial insertion moves the true center forward and lowers available capacity.
const moment=fixture('forklift-electric-4w',false,true),momentProduct=moment.runtime.products.get(moment.pallet);momentProduct.classification=Object.assign({},momentProduct.classification,{mass:1500});
moment.pallet.position.z=vehicles.getDimensions(moment.config).forkHeelZ+.65;moment.scene.updateMatrixWorld(true);const candidate=moment.api.forkCandidate(moment.record,momentProduct);assert(candidate);near(candidate.loadCenter,.65);
assert.equal(moment.api.pickup(moment.record),false,'1500 kg cannot use nominal1800 kg rating when its center is .65 m from the fork heel.');assert.equal(momentProduct.sourceEntry,undefined);
moment.pallet.position.z=vehicles.getDimensions(moment.config).forkHeelZ+.48;moment.scene.updateMatrixWorld(true);assert(moment.api.pickup(moment.record),moment.v.warning);near(moment.v.loadCenter,.48);near(moment.api.variables(moment.record).capacityKg,1800);moment.runtime.stop();

// Actual sections are transformed into each pallet's local frame, including scale.
const scaled=fixture('forklift-electric-4w',false,true),scaledProduct=scaled.runtime.products.get(scaled.pallet),pockets=scaled.api.productPockets(scaledProduct);
scaled.pallet.scale.y=.25;scaled.scene.updateMatrixWorld(true);const thinTop=pockets.maxY*.25;assert(scaled.api.applyPose(scaled.record,Object.assign({},scaled.v.pose,{lift:thinTop-scaled.config.forkBaseHeight}),false));
assert.equal(scaled.api.forkCandidate(scaled.record,scaledProduct),null,'A45 mm tine cannot enter a vertically compressed pallet opening.');scaled.runtime.stop();
const lateral=fixture('forklift-electric-4w',false,true),lateralProduct=lateral.runtime.products.get(lateral.pallet),lp=lateral.api.productPockets(lateralProduct);
lateral.pallet.scale.x=.8;lateral.pallet.position.x=.025;lateral.scene.updateMatrixWorld(true);const oldWidth=lateral.config.forkWidth;lateral.v.config.forkSpread=Math.abs(lp.centersX[1]-lp.centersX[0])*.8;lateral.v.config.forkWidth=lp.widthX*.8-.01;
assert.equal(lateral.api.forkCandidate(lateral.record,lateralProduct),null,'An offset tine wider than the remaining real slot clearance is refused.');lateral.v.config.forkWidth=oldWidth*.5;lateral.pallet.position.x=0;lateral.scene.updateMatrixWorld(true);assert(lateral.api.forkCandidate(lateral.record,lateralProduct),'A physically fitting centered scaled entry remains valid.');lateral.runtime.stop();
const pitched=fixture('forklift-electric-4w',false,true),pitchedProduct=pitched.runtime.products.get(pitched.pallet);pitched.pallet.rotation.x=.08;pitched.scene.updateMatrixWorld(true);assert.equal(pitched.api.forkCandidate(pitched.record,pitchedProduct),null,'Clearance is checked along both ends of the inserted tine, not at a single point that can hide deck penetration.');pitched.runtime.stop();

// Boom lift is a real vertical displacement, including speed reduction when loaded.
const tele=fixture('telehandler',false,true);assert(tele.api.pickup(tele.record),tele.v.warning);step(tele,6,{lift:1});assert(tele.api.variables(tele.record).lift>1.5);step(tele,2,{throttle:1});assert(tele.v.actualSpeed<=tele.v.speed*.18+1e-6,'An elevated telehandler load uses the same reduced travel limit as a raised mast.');tele.runtime.stop();
const authored=vehicles.normalize(Object.assign(vehicles.defaults('telehandler'),{initialLift:3})),authoredObject=prefabs.createVehicle(authored),authoredTool=authoredObject.userData.vehicleRig.forks;authoredObject.updateMatrixWorld(true);near(authoredTool.getWorldPosition(new THREE.Vector3()).y,authored.initialLift+authored.forkBaseHeight);assert(vehicles.initialPose(authored).reach>0);assert.throws(()=>vehicles.normalize(Object.assign(vehicles.defaults('telehandler'),{maxLift:6,initialLift:5})),/alcance/);

// A trailer in motion or actively possessed cannot be captured by a stopped tow.
const tow=fixture('tow-tractor',false,false),cart=tow.addVehicle('transport-cart',[0,0,-2.18]);cart.components.vehicle.actualSpeed=.8;assert.equal(tow.api.couple(tow.record),false);assert.equal(cart.components.vehicle.towedBy,'');cart.components.vehicle.actualSpeed=0;cart.components.vehicle.driving=true;assert.equal(tow.api.couple(tow.record),false);cart.components.vehicle.driving=false;assert(tow.api.couple(tow.record));step(tow,1,{throttle:1});assert(cart.components.vehicle.distance>.1,'A towed cart reports its real distance rather than remaining at zero.');tow.runtime.stop();

// A pallet can leave a transport cart through real aligned forks, without a clone.
const unload=fixture('transport-cart',true,true),unloadProduct=unload.runtime.products.get(unload.pallet);unload.pallet.position.set(0,unload.config.height+.045,0);unload.scene.updateMatrixWorld(true);assert(unload.api.pickup(unload.record));const cartEntry=unload.v.entry,entryPopulation=unload.runtime.sourceRuntime.entries.size,forklift=unload.addVehicle('forklift-electric-4w',[-1.95,0,0]),forkConfig=forklift.components.vehicle.config,cartPockets=unload.api.productPockets(unloadProduct);forkConfig.forkSpread=Math.abs(cartPockets.centersZ[1]-cartPockets.centersZ[0]);prefabs.refreshVehicleGeometry(forklift.components.vehicle.visualRoot,forkConfig);forklift.object.rotation.y=Math.PI/2;unload.scene.updateMatrixWorld(true);assert(unload.api.applyPose(forklift,Object.assign({},forklift.components.vehicle.pose,{lift:unload.config.height+.045}),false),'Fixture starts with already raised forks; a live hydraulic move may not pass through the cart deck.');
unload.v.paused=true;assert.equal(unload.api.pickup(forklift),false);assert.equal(unload.v.entry,cartEntry);unload.v.paused=false;unload.v.actualSpeed=.3;assert.equal(unload.api.pickup(forklift),false);unload.v.actualSpeed=0;
assert(unload.api.pickup(forklift),forklift.components.vehicle.warning);assert.equal(unload.v.entry,null);assert.deepEqual(unload.v.queue,[]);assert.equal(forklift.components.vehicle.entry,cartEntry);assert.equal(unloadProduct.vehicleOwnerId,forklift.id);assert.equal(unload.runtime.sourceRuntime.entries.size,entryPopulation);assert.equal(unload.v.deliveredUnits,24);assert.equal(forklift.components.vehicle.receivedUnits,24);assert.equal(unload.runtime.productMetadata(unloadProduct).mass,145);unload.record=forklift;const loadHeight=unloadProduct.item.box.min.y;step(unload,.5,{lift:1});assert(!forklift.components.vehicle.blocked);assert(unloadProduct.item.box.min.y>loadHeight+.05,'The same145 kg pallet physically lifts off the real cart without hidden overlaps.');unload.runtime.stop();

// Actual hydraulic motion, rather than held inputs, drives sound and useful time.
const hydraulic=fixture('forklift-electric-4w',true,false);step(hydraulic,.1,{lift:1});assert(hydraulic.v.hydraulicMoving);hydraulic.v.blocked=true;step(hydraulic,.1,{lift:1});assert(!hydraulic.v.blocked,'A successful hydraulic move clears an obsolete obstruction.');hydraulic.api.applyPose(hydraulic.record,Object.assign({},hydraulic.v.pose,{lift:hydraulic.config.maxLift}),false);const useful=hydraulic.v.runSeconds;step(hydraulic,.1,{lift:1});assert.equal(hydraulic.v.hydraulicMoving,false);near(hydraulic.v.runSeconds,useful);hydraulic.runtime.stop();

// Production RayControl has deactivateState, but no removeState convenience API.
const drivingSource=fs.readFileSync(path.join(__dirname,'test-vehicle-driving.js'),'utf8'),helpers=new Function('require','__dirname',drivingSource.slice(0,drivingSource.indexOf('const desktop = setup();'))+'\nreturn {setup};')(require,__dirname);
const driver=helpers.setup(true);delete driver.ctx.raycontrol.removeState;assert(driver.driving.mount(driver.record.id));const stateName=driver.driving.worldState.name;assert(driver.ctx.raycontrol.states[stateName]);assert(driver.driving.unmount());assert.equal(driver.ctx.raycontrol.states[stateName],undefined);assert.equal(driver.active.size,0);driver.driving.dispose();driver.runtime.stop();
console.log('Vehicle adversarial audit: atomic pickup refusal, real engagement collision, paused/emergency custody, actual load moment, scaled fork clearance, telehandler lift/speed, trailer capture and XR state cleanup passed.');
