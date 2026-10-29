const __layout = require("../../tooling/layout.cjs");
'use strict';
// Real meshes, unchanged metric FK, useful side-pad contact and the actual
// compact VR cell. No rendered silhouette or TCP-only test can prove clearance.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const robots = require('../../modules/logistica-industrial/functions/robots/schema/robots'), kinematics = require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics'), schema = require('../../modules/logistica-industrial/contracts/behaviors');
const prefabs = require('../support/load-robot-prefabs')(THREE);
const near = (a, b, epsilon = 1e-6) => assert(Math.abs(a - b) <= epsilon, a + ' != ' + b);
function toolBounds(rig, mesh) {
  return mesh.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().getInverse(rig.toolAssembly.matrixWorld).multiply(mesh.matrixWorld));
}
function cachedBodies() {
  let count = 0;
  for (const definition of robots.VARIANTS) for (const detail of ['low', 'balanced', 'high']) {
    const config = robots.normalize({...definition.preset, detail}), object = prefabs.createRobot(config), rig = object.userData.robotRig;
    const bodies = rig.collisionBodies, groups = rig.collisionGroups;
    assert(bodies.length && bodies.length < 100, 'Cached physical parts stay bounded.');
    assert.equal(new Set(bodies.map(body => body.object)).size, bodies.length);
    assert.equal(groups.reduce((sum, group) => sum + group.bodies.length, 0), bodies.length);
    for (const body of bodies) {
      assert(!body.object.userData.industrialCosmeticDetail);
      assert.deepEqual(body.meshes, [body.object]);
      assert.equal(body.role === 'contact', !!body.object.userData.robotContactSurface);
      const positions = body.object.geometry.attributes.position, epsilon = 1e-7;
      for (let i = 0; i < positions.count; i++) assert(body.bounds.clone().expandByScalar(epsilon).containsPoint(new THREE.Vector3().fromBufferAttribute(positions, i)), 'Actual local vertices must fit their own cached envelope.');
    }
    const home = kinematics.homePose(config), changed = kinematics.forward(config, robots.getJointDefinitions(config).map((joint, index) => joint.home + (index % 2 ? -.08 : .08)));
    for (const pose of [home, changed]) {
      prefabs.updateRobotPose(object, {...pose, open: .25, gripSpan: .38});
      assert.equal(rig.collisionBodies, bodies, 'Pose changes reuse the same cached bodies.');
      const tcp = prefabs.getRobotToolTransform(object);
      near(tcp.position.distanceTo(new THREE.Vector3().fromArray(pose.toolPosition)), 0);
      for (const body of bodies) {
        const measured = body.object.geometry.boundingBox.clone().applyMatrix4(body.object.matrixWorld), cached = body.bounds.clone().applyMatrix4(body.object.matrixWorld);
        near(cached.min.distanceTo(measured.min), 0); near(cached.max.distanceTo(measured.max), 0);
      }
    }
    assert.doesNotThrow(() => JSON.stringify(object.toJSON()), 'Non-enumerable rig caches must never serialize cyclic mesh references.');
    count++;
  }
  console.log('Robot collision geometry: ' + count + ' variant/detail combinations, cached real oriented bodies, exact moving transforms and lossless TCP passed.');
}
function gripperContact() {
  const config = robots.defaults('articulated-general'), object = prefabs.createRobot(config), rig = object.userData.robotRig;
  for (const height of [.02, .08, .25]) {
    const span = .3, depth = kinematics.getToolContactDepth(config, height), carton = new THREE.Box3(new THREE.Vector3(-depth, -.15, -span / 2), new THREE.Vector3(height - depth, .15, span / 2));
    prefabs.updateRobotPose(object, {...kinematics.homePose(config), open: 0, gripSpan: span});
    near(depth, Math.min(.04, height / 2));
    for (const finger of rig.fingers) {
      const sign = finger.userData.robotFingerSign, pad = finger.children.find(child => child.userData.robotContactSurface === 'jaw'), metal = finger.children.find(child => !child.userData.robotContactSurface);
      const padBox = toolBounds(rig, pad), metalBox = toolBounds(rig, metal);
      near(sign > 0 ? padBox.min.z : -padBox.max.z, span / 2);
      assert(padBox.max.x > carton.min.x && padBox.min.x < carton.max.x, 'Real pads touch the carton sides below its top.');
      assert(sign > 0 ? metalBox.min.z > span / 2 + .007 : metalBox.max.z < -span / 2 - .007, 'Metal fingers clear the side instead of entering the carton.');
    }
    for (const mesh of [rig.gripperRail, rig.toolAssembly.children.find(child => /Actuador/.test(child.name))]) assert(toolBounds(rig, mesh).max.x < carton.min.x - .05, 'The actuator and telescopic guide remain above the carton.');
  }
  near(kinematics.getDimensions(config).toolLength, .2);
  // Configuration objects are stable in runtime but users can change tool.
  config.tool = 'vacuum'; near(kinematics.getToolContactDepth(config, .3), 0);
  console.log('Gripper geometry: 40 mm bounded side insertion, actual rubber contact, metal/body clearance, short cartons and unchanged 200 mm flange offset passed.');
}
function cartons(entry) {
  const {spec, load} = entry, plan = schema.productSources.palletPlan(spec, load), base = schema.productSources.pallets.dimensions(load, true);
  const placements = plan.placements || Array.from({length: plan.units}, (_, i) => ({x: (i % load.palletColumns) * (spec.width + .02) + (plan.width - load.palletColumns * (spec.width + .02) + .02) / 2,
    z: (Math.floor(i / load.palletColumns) % load.palletRows) * (spec.depth + .02) + (plan.depth - load.palletRows * (spec.depth + .02) + .02) / 2, y: Math.floor(i / (load.palletColumns * load.palletRows)) * spec.height, width: spec.width, depth: spec.depth}));
  return placements.map(p => new THREE.Box3(new THREE.Vector3(p.x - plan.width / 2, base.height + p.y, p.z - plan.depth / 2), new THREE.Vector3(p.x - plan.width / 2 + p.width, base.height + p.y + spec.height, p.z - plan.depth / 2 + p.depth)).expandByScalar(-.005));
}
function intersectingBodies(rig, matrix, solids) {
  const inverse = new THREE.Matrix4().getInverse(matrix), hits = [];
  for (const body of rig.collisionBodies) {
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, body.object.matrixWorld), broad = body.bounds.clone().applyMatrix4(transform);
    if (!solids.some(box => box.intersectsBox(broad))) continue;
    const geometry = body.object.geometry, positions = geometry.attributes.position, index = geometry.index;
    const triangle = new THREE.Triangle(), at = (i, output) => output.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(transform);
    for (let i = 0; i < (index ? index.count : positions.count); i += 3) {
      at(i, triangle.a); at(i + 1, triangle.b); at(i + 2, triangle.c);
      if (solids.some(box => box.intersectsTriangle(triangle))) {hits.push(body); break;}
    }
  }
  return hits;
}
function compactHome() {
  const code = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-robot-contact-geometry.js"), 'test-conveyor-mechanisms.js')), 'utf8'), {setup} = new Function('require', '__dirname', code.slice(0, code.indexOf('async function run()')) + '\nreturn {setup};')(require, __dirname);
  const f = setup(), study = require('../support/load-study-scenes')(THREE, schema, f.document.constructor), built = study.buildStudyScene(f.document, 'hall', 'vr-robot-dispatch', {scene: f.scene, preview: true, continuous: false}), line = built.lines[0];
  f.scene.updateMatrixWorld(true); f.runtime.start('hall');
  try {
    const record = f.runtime.records.get(line.controller.userData.editorId), component = record.components.robot, rig = component.visualRoot.userData.robotRig;
    const source = f.runtime.records.get(line.source.userData.editorId), product = f.runtime.sourceRuntime.materialize(source, source.components.source), entry = f.runtime.sourceRuntime.entryForProduct(source, product);
    const belt = line.objects.map(object => f.runtime.records.get(object.userData.editorId)).find(row => row.components.conveyor), envelope = cartons(entry), config = component.config;
    assert.equal(entry.units, 4); near(f.runtime.productMetadata(product).mass, 33);
    const home = kinematics.homePose(config), old = kinematics.homePose({...config, jointLimitsJson: '[]'});
    const item = {...product.item, bounds: product.bounds, scale: product.scale, route: 'main', lateral: 0};
    let oldHits = [];
    for (const offset of [-belt.components.conveyor.config.length / 2, belt.components.conveyor.config.length / 2 - .3]) {
      const matrix = f.runtime.packageMatrix(belt, belt.components.conveyor, offset, item);
      prefabs.updateRobotPose(component.visualRoot, old); f.scene.updateMatrixWorld(true); oldHits.push(...intersectingBodies(rig, matrix, envelope));
      prefabs.updateRobotPose(component.visualRoot, home); f.scene.updateMatrixWorld(true);
      assert.deepEqual(intersectingBodies(rig, matrix, envelope).map(body => body.object.name), [], 'Actual authored folded home must clear carton interiors both at chain input and retention point.');
    }
    assert(oldHits.some(body => body.object.userData.industrialMaterialRole === 'frame'), 'Regression must reproduce a true orange-casting/carton intersection with the former catalogue home.');
    near(config.reach, 3.2); near(kinematics.getDimensions(config).toolLength, .2); near(home.tcp.x, .35, .002); near(home.tcp.y, 1.1, .002);
    console.log('Compact VR home: old orange casting penetration reproduced; actual folded home clears all four real cartons at chain input and retention without changing reach, pallet, units or mass.');
  } finally {f.runtime.stop();}
}
cachedBodies(); gripperContact(); compactHome();
