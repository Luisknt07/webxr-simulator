import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../packages/tools/editor/src/SceneEditor.js',import.meta.url),'utf8');
const section=source.slice(source.indexOf('  resize() {'),source.indexOf('\n  home() {'));
const body=section.slice(section.indexOf('{')+1,section.lastIndexOf('}'));
function resize(active){const calls=[],camera=()=>({aspect:1,updateProjectionMatrix(){calls.push('projection');}}),ctx={renderer:{setSize(...args){calls.push(['renderer',...args]);}},graphics:{setViewport(...args){calls.push(['graphics',...args]);}},camera:camera()};const editor={active,viewport:{clientWidth:880,clientHeight:600},ctx,camera:camera()};new Function('window','document',body).call(editor,{innerWidth:1440,innerHeight:1000,devicePixelRatio:2},{documentElement:{clientWidth:390,clientHeight:844}});return{editor,calls};}
test('Viewer corrects a stale desktop canvas on a 390px mobile viewport',()=>{const {editor,calls}=resize(false);assert.deepEqual(calls.find(row=>Array.isArray(row)&&row[0]==='renderer'),['renderer',390,844]);assert.deepEqual(calls.find(row=>Array.isArray(row)&&row[0]==='graphics'),['graphics',390,844,2]);assert.equal(editor.ctx.camera.aspect,390/844);});
test('Editor still renders its viewport while retaining the player camera aspect',()=>{const {editor,calls}=resize(true);assert.deepEqual(calls.find(row=>Array.isArray(row)&&row[0]==='renderer'),['renderer',880,600]);assert.equal(editor.camera.aspect,880/600);assert.equal(editor.ctx.camera.aspect,390/844);});
