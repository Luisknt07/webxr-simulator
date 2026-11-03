import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../packages/tools/editor/src/SceneEditor.js',import.meta.url),'utf8');
const section=source.slice(source.indexOf('  resize() {'),source.indexOf('\n  home() {'));
const body=section.slice(section.indexOf('{')+1,section.lastIndexOf('}'));
function fixture(){
  const calls=[],attrs=new Set(),style={removeProperty(key){delete this[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())];}},reticle={style:{removeProperty(key){delete this[key];}}};
  const camera=()=>({aspect:1,updateProjectionMatrix(){}}),canvas={style,setAttribute(key){attrs.add(key);},hasAttribute:key=>attrs.has(key),removeAttribute:key=>attrs.delete(key)};
  const frame={hidden:false,getBoundingClientRect:()=>({left:302,top:142,width:810,height:720})};
  const doc={documentElement:{clientWidth:1440,clientHeight:1000},querySelector:()=>frame,getElementById:()=>reticle};
  const editor={active:false,viewport:{clientWidth:900,clientHeight:650},camera:camera(),ctx:{vrMode:false,camera:camera(),renderer:{domElement:canvas,setSize:(...args)=>calls.push(args)},graphics:{setViewport(){}}}};
  const run=()=>new Function('window','document',body).call(editor,{innerWidth:1440,innerHeight:1000,devicePixelRatio:1},doc);
  return{editor,frame,canvas,reticle,calls,run,doc};
}
test('Practice desktop renders into the actual centre frame and aligns camera and reticle to it',()=>{
  const f=fixture();f.run();assert.deepEqual(f.calls[0],[810,720]);assert.equal(f.editor.ctx.camera.aspect,810/720);
  assert.equal(f.canvas.style.position,'fixed');assert.equal(f.canvas.style.left,'302px');assert.equal(f.canvas.style.top,'142px');
  assert.equal(f.reticle.style.left,'707px');assert.equal(f.reticle.style.top,'502px');
});
test('Entering XR or returning to the editor clears practice canvas offsets without changing the scene',()=>{
  const f=fixture();f.run();f.editor.ctx.vrMode=true;f.run();assert.deepEqual(f.calls[1],[1440,1000]);assert.equal(f.editor.ctx.camera.aspect,1.44);
  assert.equal(f.canvas.style.position,undefined);assert.equal(f.reticle.style.left,undefined);
  f.editor.ctx.vrMode=false;f.run();f.editor.active=true;f.run();assert.deepEqual(f.calls[3],[900,650]);assert.equal(f.canvas.style.left,undefined);assert.equal(f.editor.ctx.camera.aspect,1.44);
});
test('Closing or hiding the practice frame restores the full viewer and a stale zero-size frame cannot shrink it',()=>{
  const f=fixture();f.run();f.frame.hidden=true;f.run();assert.deepEqual(f.calls[1],[1440,1000]);
  f.frame.hidden=false;f.frame.getBoundingClientRect=()=>({left:0,top:0,width:0,height:0});f.run();assert.deepEqual(f.calls[2],[1440,1000]);assert.equal(f.canvas.hasAttribute('data-practice-render-viewport'),false);
});
