import test from 'node:test';
import assert from 'node:assert/strict';
import SceneCaptureToolbar, {captureTimer} from '../SceneCaptureToolbar.js';
import {readFileSync} from 'node:fs';

class Element {
    constructor(tag, document) { this.tagName=tag; this.ownerDocument=document; this.children=[]; this.parentNode=null; this.handlers=new Map(); this.attributes=new Map(); this.dataset={}; this.hidden=false; this.disabled=false; this._text=''; this.clicks=0; }
    set innerHTML(_) { throw new Error('Capture controls must use safe DOM text.'); }
    set textContent(value) { this._text=String(value); for(const child of this.children)child.parentNode=null; this.children=[]; }
    get textContent() { return this._text+this.children.map(row=>row.textContent).join(''); }
    appendChild(node) { node.parentNode=this; this.children.push(node); return node; }
    removeChild(node) { this.children=this.children.filter(row=>row!==node); node.parentNode=null; }
    setAttribute(name,value) { this.attributes.set(name,String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    removeAttribute(name) { this.attributes.delete(name); if(name==='href'||name==='download')delete this[name]; }
    addEventListener(type,callback) { const rows=this.handlers.get(type)||[]; rows.push(callback); this.handlers.set(type,rows); }
    removeEventListener(type,callback) { this.handlers.set(type,(this.handlers.get(type)||[]).filter(row=>row!==callback)); }
    fire(type, properties={}) {
        const event={target:this,stopped:false,defaultPrevented:false,stopPropagation(){this.stopped=true;},preventDefault(){this.defaultPrevented=true;},...properties};
        for(let node=this;node;node=node.parentNode) { for(const fn of [...node.handlers.get(type)||[]])fn(event); if(event.stopped)break; }
        return event;
    }
    click() { this.clicks++; if(!this.disabled)this.fire('click'); }
}
const walk=node=>[node,...node.children.flatMap(walk)];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
    const document={createElement:tag=>new Element(tag,document)},host=document.createElement('div'),urls=[],revoked=[],subscribers=new Set(),captureListeners=new Set(),calls=[];
    let state={phase:'idle',busy:false,canPhoto:true,canRecord:true,photoPending:false,recording:false,preparing:false,elapsedMs:0,blockedReason:'',recordingReason:'',message:'',epoch:0,maxDurationMs:120000};
    const emit=patch=>{state={...state,...patch}; for(const fn of subscribers)fn(state);};
    const result={kind:'photo',blob:new Blob(['frame'],{type:'image/png'}),filename:'smarttwin-escenario.png',width:1600,height:1000};
    const controller={getState:()=>state,subscribe(fn){subscribers.add(fn);fn(state);return()=>subscribers.delete(fn);},onCapture(fn){captureListeners.add(fn);return()=>captureListeners.delete(fn);},
        capturePhoto(){calls.push('photo');emit({photoPending:true,canPhoto:false});return Promise.resolve(result);},startRecording(){calls.push('start');emit({phase:'recording',recording:true,canRecord:false});return Promise.resolve();},stopRecording(){calls.push('stop');emit({phase:'stopping',recording:false});return Promise.resolve(result);},cancel(){calls.push('cancel');emit({phase:'idle',recording:false,preparing:false,canRecord:true,epoch:state.epoch+1});},dispose(){calls.push('dispose-controller');}};
    const window={URL:{createObjectURL(blob){assert(blob instanceof Blob);const url='blob:test-'+urls.length;urls.push(url);return url;},revokeObjectURL(url){revoked.push(url);}}};
    const toolbar=new SceneCaptureToolbar({document,window,controller,onInteract:()=>calls.push('interact')}); toolbar.mount(host);
    return {document,window,host,toolbar,controller,emit,state:()=>state,urls,revoked,calls,subscribers,captureListeners,result,publish:value=>{for(const fn of captureListeners)fn(value);}};
}

test('capture UI is compact, local, accessible and renders no media/device/upload elements',()=>{
    const f=fixture(),all=walk(f.host);
    assert.equal(f.toolbar.root.getAttribute('role'),'toolbar'); assert.equal(f.toolbar.root.getAttribute('aria-label'),'Capturar vista 3D');
    assert.equal(f.toolbar.photoButton.getAttribute('aria-label'),'Guardar foto del escenario'); assert.equal(f.toolbar.recordButton.getAttribute('aria-pressed'),'false');
    assert.equal(f.toolbar.cancelButton.hidden,true); assert.equal(f.toolbar.timer.hidden,true); assert.equal(f.toolbar.downloadLink.hidden,true);
    assert.equal(all.some(node=>['iframe','audio','video','input','script'].includes(node.tagName)),false); assert.equal(f.calls.length,0); f.toolbar.dispose();
});

test('photo, start/stop and discard actions stay inside the toolbar without preventing native activation',async()=>{
    const f=fixture(); let leaked=0; f.host.addEventListener('keydown',()=>leaked++); f.host.addEventListener('click',()=>leaked++);
    const event=f.toolbar.photoButton.fire('keydown',{key:' '}); assert.equal(event.defaultPrevented,false); assert.equal(leaked,0);
    f.toolbar.photoButton.click(); await flush(); assert(f.calls.includes('photo')); assert.equal(f.toolbar.photoButton.captureLabel.textContent,'Capturando…'); assert(f.toolbar.photoButton.disabled);
    f.emit({photoPending:false,canPhoto:true}); f.toolbar.recordButton.click(); await flush(); assert.equal(f.toolbar.recordButton.captureLabel.textContent,'Detener'); assert.equal(f.toolbar.recordButton.getAttribute('aria-pressed'),'true');
    f.emit({elapsedMs:65200}); assert.equal(f.toolbar.timer.textContent,'01:05'); assert.equal(f.toolbar.cancelButton.hidden,false);
    f.toolbar.recordButton.click(); await flush(); assert(f.calls.includes('stop')); assert.equal(f.toolbar.recordButton.captureLabel.textContent,'Guardando…'); assert(f.toolbar.recordButton.disabled);
    f.emit({phase:'recording',recording:true}); f.toolbar.cancelButton.click(); assert(f.calls.includes('cancel')); assert.equal(f.toolbar.timer.hidden,true); assert.equal(leaked,0); f.toolbar.dispose();
});

test('valid captures download locally and retain a manual link with bounded object URL lifetime',()=>{
    const f=fixture(); f.publish(f.result);
    assert.equal(f.toolbar.downloadLink.hidden,false); assert.equal(f.toolbar.downloadLink.href,'blob:test-0'); assert.equal(f.toolbar.downloadLink.download,'smarttwin-escenario.png'); assert.equal(f.toolbar.downloadLink.clicks,1);
    assert.equal(f.toolbar.downloadLink.textContent,'Descargar foto'); assert.match(f.toolbar.downloadLink.getAttribute('aria-label'),/1600 por 1000/);
    f.publish({...f.result,kind:'video',filename:'video.webm'}); assert.deepEqual(f.revoked,['blob:test-0']); assert.equal(f.toolbar.downloadLink.textContent,'Descargar vídeo');
    f.emit({epoch:1,message:'Proyecto cambiado.'}); assert.deepEqual(f.revoked,['blob:test-0','blob:test-1']); assert.equal(f.toolbar.downloadLink.hidden,true); assert.equal(f.toolbar.downloadLink.href,undefined);
    f.publish(f.result); f.toolbar.dispose(); assert.deepEqual(f.revoked,['blob:test-0','blob:test-1','blob:test-2']);
});

test('unsupported video still allows photos; XR disables both and explains the actual limitation',()=>{
    const f=fixture(); f.emit({canRecord:false,recordingReason:'Vídeo no disponible en este navegador. Puedes guardar una foto.'});
    assert.equal(f.toolbar.photoButton.disabled,false); assert.equal(f.toolbar.recordButton.disabled,true); assert.match(f.toolbar.status.textContent,/Puedes guardar una foto/);
    f.emit({canPhoto:false,epoch:1,blockedReason:'Sal de RV para capturar la vista de escritorio.'});
    assert.equal(f.toolbar.photoButton.disabled,true); assert.equal(f.toolbar.recordButton.disabled,true); assert.match(f.toolbar.status.textContent,/Sal de RV/); assert.equal(f.urls.length,0); f.toolbar.dispose();
});

test('tab-hidden completion keeps a local manual link instead of losing or auto-downloading the valid clip',()=>{
    const f=fixture(); f.document.hidden=true; f.emit({blockedReason:'Vuelve a esta página para capturar.'});
    f.publish({...f.result,kind:'video',filename:'video.webm'});
    assert.equal(f.toolbar.downloadLink.hidden,false); assert.equal(f.toolbar.downloadLink.clicks,0); assert.equal(f.toolbar.downloadLink.href,'blob:test-0');
    f.document.hidden=false; f.emit({blockedReason:''}); f.toolbar.downloadLink.click(); assert.equal(f.toolbar.downloadLink.clicks,1); f.toolbar.dispose();
});

test('capture errors are safe text and disposed buttons/callbacks cannot download or touch shared controller',async()=>{
    const f=fixture(); f.controller.capturePhoto=()=>Promise.reject(new Error('<img src=x onerror=steal()>'));
    f.toolbar.photoButton.click(); await flush(); assert.equal(f.toolbar.status.textContent,'<img src=x onerror=steal()>'); assert.equal(walk(f.host).some(node=>node.tagName==='img'),false);
    const oldButton=f.toolbar.photoButton,oldRoot=f.toolbar.root,oldCalls=f.calls.length; f.toolbar.dispose(); oldButton.click(); f.publish(f.result); await flush();
    assert.equal(f.calls.length,oldCalls); assert.equal(f.calls.includes('dispose-controller'),false); assert.equal(f.host.children.length,0); assert.equal(f.urls.length,0); assert.equal(f.subscribers.size,0); assert.equal(f.captureListeners.size,0);
    assert.equal(walk(oldRoot).reduce((sum,node)=>sum+[...node.handlers.values()].reduce((total,rows)=>total+rows.length,0),0),0);
});

test('cancelled capture promises never display an error; missing local-download support is honest',async()=>{
    const f=fixture(); f.controller.capturePhoto=()=>Promise.reject(Object.assign(new Error('Private scene revoked'),{name:'AbortError'})); f.toolbar.photoButton.click(); await flush(); assert.equal(f.toolbar.error,'');
    delete f.window.URL.createObjectURL; f.publish(f.result); assert.match(f.toolbar.status.textContent,/no permite descargar/); assert.equal(f.toolbar.downloadLink.hidden,true); f.toolbar.dispose();
});

test('timer and scoped styles keep mobile controls touch-sized without a global viewport overlay',()=>{
    assert.equal(captureTimer(-10),'00:00'); assert.equal(captureTimer(120000),'02:00');
    const css=readFileSync(new URL('../scene-capture.css',import.meta.url),'utf8');
    assert.match(css,/min-height:44px/); assert.match(css,/prefers-reduced-motion/); assert.match(css,/\.scene-capture-toolbar \[hidden\]/); assert.doesNotMatch(css,/position:fixed|\bbody\s*\{|\bhtml\s*\{/);
});
