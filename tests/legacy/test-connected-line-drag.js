const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const file = __layout.map(path.join(__layout.oldDir("scripts/test-connected-line-drag.js"), 'test-editor-connection-reflow.js')), text = fs.readFileSync(file, 'utf8');
const {fixture, line, settle, THREE} = new Function('require', '__dirname', text.slice(0, text.lastIndexOf('\nasync function run()')) + '\nreturn {fixture,line,settle,THREE};')(createRequire(file), __dirname);
const id = object => object.userData.editorId, clone = value => JSON.parse(JSON.stringify(value));
const world = object => object.getWorldPosition(new THREE.Vector3());
const near = (a, b, label) => assert(a.distanceTo(b) < 1e-6, label + ': ' + a.toArray() + ' / ' + b.toArray());

async function run() {
  {
    const f = await fixture(), parts = line(f), machines = Object.values(parts).filter(object => object !== parts.outsider);
    const monitor = f.document.addPrimitive('hall', 'box'), panel = f.document.addPrimitive('hall', 'box'), stand = f.document.addPrimitive('hall', 'box'), alienStand = f.document.addPrimitive('hall', 'box');
    f.document.setBehaviors(monitor, [{type: 'lineMonitor', targetId: id(parts.first), scope: 'line'}]);
    f.document.setBehaviors(panel, [{type: 'control', targetId: id(parts.processor), variable: 'running', mode: 'toggle'}]);
    f.document.setTransform(monitor, {position: [2, 2, -25]}); f.document.setTransform(panel, {position: [3, 1.5, -25]}); f.document.setTransform(stand, {position: [2, .5, -25]}); f.document.setTransform(alienStand, {position: [40, .5, 20]});
    f.document.setStudio({groups: [
      {id: 'whole-level', name: 'Includes another network', roomId: 'hall', members: machines.concat(parts.outsider, alienStand).map(id)},
      {id: 'one-line', name: 'One actual line', roomId: 'hall', members: machines.concat(monitor, panel, stand).map(id)}
    ]});
    const moving = machines.concat(monitor, panel, stand), baseline = new Map(moving.map(object => [object, world(object)])), outsider = world(parts.outsider), unrelated = world(alienStand);
    const configurations = machines.map(object => clone(f.document.getBehaviors(object))), before = await f.document.serialize(), depth = f.document.undoStack.length, primary = parts.first.position.clone();
    f.editor.select(parts.first); f.editor.setTool('translate'); f.drag(true);
    assert(f.assembly.drag.component); assert(/Mover línea/.test(f.editor.assemblyHint.textContent));
    for (const delta of [new THREE.Vector3(3, 0, -2), new THREE.Vector3(6, 0, -4), new THREE.Vector3(), new THREE.Vector3(3, 0, -2)]) {
      parts.first.position.copy(primary).add(delta); f.editor.transform.dispatchEvent({type: 'objectChange'}); f.joined();
      moving.forEach(object => near(world(object), baseline.get(object).clone().add(delta), 'Connected machine/monitor/control/platform follows exactly once'));
      near(world(parts.outsider), outsider, 'Another network stays fixed'); near(world(alienStand), unrelated, 'A broad group cannot pull another network');
    }
    machines.forEach((object, index) => assert.deepEqual(f.document.getBehaviors(object), configurations[index], 'Dragging preserves IDs, parameters, panel ownership and links.'));
    f.drag(false); await settle(); assert.equal(f.document.undoStack.length, depth + 1); const after = await f.document.serialize();
    await f.editor.perform(() => f.editor.historyStep('undo')); await settle(); assert.deepEqual(await f.document.serialize(), before);
    await f.editor.perform(() => f.editor.historyStep('redo')); await settle(); assert.deepEqual(await f.document.serialize(), after); f.joined(); f.close();
  }
  {
    const f = await fixture(), parts = line(f);f.document.setStudio({groups:[{id:'implicit-line',name:'Existing logical group',roomId:'hall',members:Object.values(parts).filter(object=>object!==parts.outsider).map(id)}]});
    const before = await f.document.serialize(), stationary = [parts.source, parts.curve, parts.tail, parts.processor, parts.stock].map(object => [object, world(object)]), depth = f.document.undoStack.length;
    f.editor.select(parts.first); f.editor.setTool('translate'); f.editor.detachDragModifier = true; f.drag(true); parts.first.position.x += 1.1; f.editor.transform.dispatchEvent({type: 'objectChange'});
    assert.equal(f.config(parts.source).outputId, ''); assert.equal(f.config(parts.first).outputId, ''); assert.equal(f.config(parts.curve).outputId, id(parts.tail));
    stationary.forEach(([object, position]) => near(world(object), position, 'Ctrl drag moves only the selected module'));
    assert(/Separar módulo/.test(f.editor.assemblyHint.textContent)); f.editor.cancelTransformDrag(); assert.deepEqual(await f.document.serialize(), before); assert.equal(f.document.undoStack.length, depth);
    const selected = f.document.getObject(id(parts.first)); f.editor.select(selected); f.editor.detachDragModifier = true; f.drag(true); selected.position.x += 1.2; f.editor.transform.dispatchEvent({type: 'objectChange'}); f.drag(false); await settle();
    assert.equal(f.document.undoStack.length, depth + 1); await f.editor.perform(() => f.editor.historyStep('undo')); await settle(); assert.deepEqual(await f.document.serialize(), before); f.close();
  }
  {
    const f = await fixture(), parts = line(f), target = f.add();
    f.document.begin(); f.assembly.align(parts.stock, 'output', target, 'input'); target.position.x += .12; f.document.setTransform(target, {position: target.position.toArray()}); f.document.commit();
    const fixed = world(target), before = await f.document.serialize(); f.editor.select(parts.first); f.editor.setTool('translate'); f.drag(true); f.editor.transform.dispatchEvent({type: 'objectChange'});
    assert.equal(f.config(parts.stock).outputId, id(target), 'The free end of the entire line snaps even when its middle is selected.'); near(world(target), fixed, 'The stationary receiving machine is not pulled along'); f.joined();
    f.drag(false); await settle(); await f.editor.perform(() => f.editor.historyStep('undo')); await settle(); assert.deepEqual(await f.document.serialize(), before); f.close();
  }
  {
    const f=await fixture(),parts=line(f),panel=f.document.addPrefab('hall','plc'),mixed=f.document.addPrefab('hall','plc'),controls=[];
    const bind=(root,shared)=>{let count=0;root.traverse(node=>{const configs=f.document.getBehaviors(node);if(configs.some(value=>value.type==='control')){f.document.setBehaviors(node,configs.map(value=>value.type==='control'?{...value,targetId:shared&&count++===0?id(parts.outsider):id(parts.first)}:value));controls.push({object:node,position:node.position.clone()});}});};
    bind(panel,false);bind(mixed,true);f.document.setTransform(panel,{position:[2,1,4]});f.document.setTransform(mixed,{position:[20,1,4]});
    const cabinet=world(panel),shared=world(mixed),before=await f.document.serialize();f.editor.select(parts.first);f.editor.setTool('translate');f.drag(true);parts.first.position.x+=2;f.editor.transform.dispatchEvent({type:'objectChange'});
    near(world(panel),cabinet.clone().add(new THREE.Vector3(2,0,0)),'A bound standalone PLC follows as one complete cabinet');near(world(mixed),shared,'A panel shared with another network stays fixed');controls.forEach(value=>near(value.object.position,value.position,'Buttons never peel away from their cabinet'));
    f.drag(false);await settle();await f.editor.perform(()=>f.editor.historyStep('undo'));await settle();assert.deepEqual(await f.document.serialize(),before);f.close();
  }
  {
    const f = await fixture(), parts = line(f), root = f.document.getRoot('hall'); root.position.set(5, 0, -3); root.rotation.y = -.7; root.scale.setScalar(1.25); root.updateWorldMatrix(true, true);
    const members = Object.values(parts).filter(object => object !== parts.outsider), initial = new Map(members.map(object => [object, world(object)])), delta = new THREE.Vector3(2, 0, -3), expected = delta.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(root.matrixWorld));
    f.editor.select(parts.first); f.editor.setTool('translate'); f.drag(true); parts.first.position.add(delta); f.editor.transform.dispatchEvent({type: 'objectChange'});
    members.forEach(object => near(world(object), initial.get(object).clone().add(expected), 'A transformed native room carries its component in world coordinates')); f.joined(); f.editor.cancelTransformDrag(); f.close();
  }
  {
    const f = await fixture(), first = f.add(), tail = f.add(), target = f.add('conveyor', 'roller-motor', {width: .5}), root = f.document.getRoot('hall'); f.connect(first, tail);
    root.scale.set(2, 1, 1); target.rotation.y = Math.PI / 2; root.updateWorldMatrix(true, true);
    const inlet = f.assembly.worldPort(target, 'input').position, outlet = f.assembly.worldPort(tail, 'output').position;
    const shift = outlet.clone().add(new THREE.Vector3(.1, 0, .1)).sub(inlet).applyMatrix3(new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().getInverse(root.matrixWorld)));
    f.document.setTransform(target, {position: target.position.clone().add(shift).toArray(), quaternion: target.quaternion.toArray()});
    const before = await f.document.serialize(), depth = f.document.undoStack.length; f.editor.select(first); f.editor.setTool('translate'); f.drag(true); f.editor.transform.dispatchEvent({type: 'objectChange'});
    assert.equal(f.editor.transform.dragging, false, 'A magnet requiring parent shear cancels the entire gesture.'); assert.deepEqual(await f.document.serialize(), before); assert.equal(f.document.undoStack.length, depth); f.close();
  }
  console.log('Connected line dragging: rigid component plus owned monitors/controls/platform, external-end magnet, isolated Ctrl detach, repeated previews, cancel and atomic undo/redo passed without database writes.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
