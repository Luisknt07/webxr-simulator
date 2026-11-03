import test from 'node:test';
import assert from 'node:assert/strict';
import SceneCaptureController, {fitCaptureSize, fitFrame, normalizeCaptureRegion, captureFilename, chooseRecordingMime} from '../SceneCaptureController.js';

class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(name, fn) { const list = this.listeners.get(name) || []; list.push(fn); this.listeners.set(name, list); }
    removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter(row => row !== fn)); }
    fire(name, event = {}) { for (const fn of [...this.listeners.get(name) || []]) fn(event); }
    listenerCount() { return [...this.listeners.values()].reduce((total, rows) => total + rows.length, 0); }
}

function fixture(options = {}) {
    let time = 0, nextTimer = 1, context = {active:true,xr:false,identity:'user-a/project-a/scene-a'}, source;
    const timers = new Map(), buffers = [], recorders = [], streams = [], encoders = [];
    class Canvas extends Target {
        constructor(width = 1, height = 1) { super(); this.width = width; this.height = height; this.draws = []; this.pixel = 'empty'; this.context = {fillRect:()=>{}, drawImage:(input, ...args)=>{
            if (options.drawError) throw options.drawError;
            this.pixel = input.pixel; this.draws.push({pixel:input.pixel,args});
        }}; }
        getContext() { return options.no2d ? null : this.context; }
        toBlob(callback, type) { encoders.push({canvas:this,callback,type,pixel:this.pixel}); if (!options.deferBlob) callback(options.emptyBlob ? null : new Blob([this.pixel], {type})); }
        captureStream(fps) {
            const track = new Target(); track.kind = 'video'; track.stopped = false; track.requests = 0;
            track.stop = () => { track.stopped = true; track.fire('ended'); };
            if (!options.noRequestFrame) track.requestFrame = () => { track.requests++; };
            const audio = options.unexpectedAudio ? {kind:'audio',stopped:false,stop(){this.stopped=true;}} : null;
            const stream = {fps,track,audio,getTracks:()=>audio ? [track,audio] : [track],getVideoTracks:()=>[track],getAudioTracks:()=>audio ? [audio] : []}; streams.push(stream); return stream;
        }
    }
    class Recorder {
        static isTypeSupported(type) { return options.mime ? type === options.mime : type === 'video/webm;codecs=vp8'; }
        constructor(stream, settings) {
            if (options.recorderThrows) throw new Error('codec unavailable');
            this.stream = stream; this.settings = settings; this.mimeType = options.actualMime || settings.mimeType || 'video/webm'; this.state = 'inactive'; recorders.push(this);
        }
        start(slice) { if (options.startThrows) throw new Error('start failed'); this.slice = slice; this.state = 'recording'; }
        emit(data = new Blob(['video-frame'], {type:this.mimeType})) { if (this.ondataavailable) this.ondataavailable({data}); }
        stop() {
            this.state = 'inactive';
            if (options.hangStop) return;
            if (!options.emptyVideo) this.emit();
            if (this.onstop) this.onstop();
        }
    }
    const window = new Target(); window.Blob = Blob; window.MediaRecorder = options.noRecorder ? null : Recorder;
    window.setTimeout = (fn, delay) => { const id = nextTimer++; timers.set(id,{fn,at:time+delay}); return id; };
    window.clearTimeout = id => timers.delete(id);
    const document = new Target(); document.hidden = false; document.defaultView = window;
    document.createElement = tag => { assert.equal(tag,'canvas'); const canvas = new Canvas(); buffers.push(canvas); return canvas; };
    source = new Canvas(2560,1440); source.pixel = 'fresh-rendered-frame'; if (options.noStream) source.captureStream = undefined;
    const controller = new SceneCaptureController({document,window,getCanvas:()=>source,getContext:()=>context,label:()=>'<Almacén / privado?>',now:()=>time,...options.controller});
    const advance = ms => {
        time += ms;
        for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); }
    };
    return {controller,document,window,Canvas,Recorder,buffers,recorders,streams,encoders,timers,advance,
        source:()=>source,replaceSource:()=>{source = new Canvas(800,600);},context:()=>context,setContext:value=>{context={...context,...value};},time:()=>time};
}

test('capture sizing preserves aspect without upscaling and uses bounded even video frames', () => {
    assert.deepEqual(fitCaptureSize(800,600),{width:800,height:600});
    assert.deepEqual(fitCaptureSize(7680,4320),{width:3840,height:2160});
    assert.deepEqual(fitCaptureSize(390,844,{maxWidth:1920,maxHeight:1080,even:true}),{width:390,height:844});
    assert.deepEqual(fitCaptureSize(853,479,{even:true}),{width:852,height:478});
    const bounds = fitCaptureSize(10000,10000); assert(bounds.width*bounds.height<=8294400);
    assert.deepEqual(fitFrame(900,1600,1920,1080),{x:656.25,y:0,width:607.5,height:1080});
    assert.throws(()=>fitCaptureSize(1,1,{even:true}),/pequeña/);
});

test('regions cannot read outside source pixels and exported filenames are local and honest', () => {
    assert.deepEqual(normalizeCaptureRegion({width:500,height:400},{x:100,y:50,width:1000,height:500}),{x:100,y:50,width:400,height:350});
    for (const region of [{x:-1,y:0,width:2,height:2},{x:0,y:0,width:Infinity,height:2},{x:0,y:0,width:0,height:2}]) assert.throws(()=>normalizeCaptureRegion({width:500,height:400},region));
    assert.match(captureFilename('../../Mi instalación:<script>', 'photo','image/png',new Date('2026-11-03T10:15:30Z')),/^smarttwin-Mi-instalacion-script-20261103-101530\.png$/);
    assert.match(captureFilename('x','video','video/mp4'),/\.mp4$/);
    assert.match(captureFilename('x','video','video/webm;codecs=vp8'),/\.webm$/);
    assert.equal(chooseRecordingMime({isTypeSupported:()=>false}),null);
    assert.equal(chooseRecordingMime(class Recorder {}),'');
});

test('PNG copies the fresh render synchronously, then encodes its detached buffer without source mutations', async () => {
    const f = fixture({deferBlob:true}), outputs=[]; f.controller.onCapture(value=>outputs.push(value));
    const source = f.source(), promise = f.controller.capturePhoto(); assert.equal(f.buffers.length,0);
    f.controller.afterRender(); assert.equal(f.buffers.length,1); assert.equal(f.buffers[0].draws[0].pixel,'fresh-rendered-frame');
    source.pixel = 'buffer-cleared-after-render';
    assert.equal(f.encoders[0].pixel,'fresh-rendered-frame');
    f.encoders[0].callback(new Blob([f.encoders[0].pixel],{type:'image/png'}));
    const result = await promise;
    assert.equal(await result.blob.text(),'fresh-rendered-frame'); assert.equal(result.mimeType,'image/png'); assert.equal(result.width,2560); assert.equal(result.height,1440);
    assert.deepEqual([source.width,source.height],[2560,1440]); assert.equal(outputs.length,1); assert.equal(f.buffers[0].width,1); assert.equal(f.timers.size,0);
    assert.equal(f.controller.getState().lastCapture.blob,undefined,'State never retains binary payload.'); f.controller.dispose();
});

test('asynchronous PNG is discarded on identity/source change before another render', async () => {
    for (const change of ['identity','source','xr','inactive']) {
        const f=fixture({deferBlob:true}),outputs=[]; f.controller.onCapture(value=>outputs.push(value));
        const promise=f.controller.capturePhoto(); f.controller.afterRender();
        if(change==='source') f.replaceSource(); else f.setContext(change==='identity'?{identity:'user-b/project-b'}:change==='xr'?{xr:true}:{active:false});
        f.encoders[0].callback(new Blob(['private frame'],{type:'image/png'}));
        await assert.rejects(promise,{name:'AbortError'}); assert.equal(outputs.length,0); assert.equal(f.controller.getState().lastCapture,null); f.controller.dispose();
    }
});

test('no fresh frame, browser encoding errors and null encodes fail visibly without leaks', async () => {
    const timeout=fixture(),promise=timeout.controller.capturePhoto(); timeout.advance(5001); await assert.rejects(promise,/fotograma/); assert.equal(timeout.timers.size,0); timeout.controller.dispose();
    const security=fixture({drawError:Object.assign(new Error('secret origin URL'),{name:'SecurityError'})}),secure=security.controller.capturePhoto(); security.controller.afterRender();
    await assert.rejects(secure,/recursos.*no permite/); assert.doesNotMatch(security.controller.getState().message,/secret/); security.controller.dispose();
    const empty=fixture({emptyBlob:true}),photo=empty.controller.capturePhoto(); empty.controller.afterRender(); await assert.rejects(photo,/guardar la foto/); empty.controller.dispose();
});

test('video starts only after a real frame, captures only video and freezes output dimensions on resize', async () => {
    const f=fixture(),outputs=[]; f.controller.onCapture(value=>outputs.push(value));
    const start=f.controller.startRecording(); assert.equal(f.recorders.length,0); assert.equal(f.controller.getState().preparing,true);
    f.controller.afterRender(); await start;
    const buffer=f.buffers[0],stream=f.streams[0],recorder=f.recorders[0];
    assert.equal(stream.fps,0); assert.equal(stream.track.requests,1); assert.equal(stream.getAudioTracks().length,0); assert.equal(recorder.slice,1000);
    assert.deepEqual([buffer.width,buffer.height],[1920,1080]); assert.deepEqual([f.source().width,f.source().height],[2560,1440]);
    f.source().width=900; f.source().height=1600; f.advance(100); f.controller.afterRender();
    assert.deepEqual([buffer.width,buffer.height],[1920,1080]); assert.deepEqual(buffer.draws[1].args,[0,0,900,1600,656.25,0,607.5,1080]);
    const result=await f.controller.stopRecording(); assert.equal(result.kind,'video'); assert.equal(result.frames,2); assert.equal(result.durationMs,100);
    assert.equal(result.mimeType,'video/webm;codecs=vp8'); assert.match(result.filename,/\.webm$/); assert.equal(outputs.length,1); assert(stream.track.stopped);
    assert.equal(stream.track.listenerCount(),0); assert.equal(f.timers.size,0); assert.equal(buffer.width,1); f.controller.dispose();
});

test('the fallback video stream uses bounded frame rate and follows actual MP4 support', async () => {
    const f=fixture({noRequestFrame:true,mime:'video/mp4',actualMime:'video/mp4'});
    const start=f.controller.startRecording(); f.controller.afterRender(); await start;
    assert.equal(f.streams.length,2); assert(f.streams[0].track.stopped); assert.equal(f.streams[1].fps,30);
    const result=await f.controller.stopRecording(); assert.match(result.filename,/\.mp4$/); assert.equal(result.mimeType,'video/mp4'); f.controller.dispose();
});

test('duration and size budgets terminate clips and do not accumulate unlimited binary chunks', async () => {
    const f=fixture({controller:{maxDurationMs:1000}}),outputs=[]; f.controller.onCapture(value=>outputs.push(value));
    const start=f.controller.startRecording(); f.controller.afterRender(); await start; f.advance(1001);
    assert.equal(outputs.length,1); assert.equal(f.controller.getState().phase,'idle'); assert.equal(f.timers.size,0); f.controller.dispose();
    const sized=fixture({controller:{maxBytes:1048576}}),videos=[]; sized.controller.onCapture(value=>videos.push(value));
    const begun=sized.controller.startRecording(); sized.controller.afterRender(); await begun;
    sized.recorders[0].emit(new Blob([new Uint8Array(950000)],{type:'video/webm'}));
    assert.equal(videos.length,1); assert(videos[0].blob.size<=1048576); sized.controller.dispose();
    const excess=fixture({controller:{maxBytes:1048576}}),none=[]; excess.controller.onCapture(value=>none.push(value));
    const active=excess.controller.startRecording(); excess.controller.afterRender(); await active;
    excess.recorders[0].emit(new Blob([new Uint8Array(1048577)],{type:'video/webm'}));
    assert.equal(none.length,0); assert.match(excess.controller.getState().message,/tamaño permitido/); assert(excess.streams[0].track.stopped); excess.controller.dispose();
});

test('stale/hidden/XR/context-lost transitions never publish another account or invalid video', async () => {
    for(const transition of ['identity','xr','inactive','source','lost','dispose']) {
        const f=fixture(),outputs=[]; f.controller.onCapture(value=>outputs.push(value));
        const start=f.controller.startRecording(); f.controller.afterRender(); await start;
        const recorder=f.recorders[0],lateData=recorder.ondataavailable,lateStop=recorder.onstop;
        if(transition==='source')f.replaceSource(); else if(transition==='lost')f.source().fire('webglcontextlost',{preventDefault(){}}); else if(transition==='dispose')f.controller.dispose();
        else f.setContext(transition==='identity'?{identity:'other-account'}:transition==='xr'?{xr:true}:{active:false});
        f.controller.afterRender(); lateData({data:new Blob(['old account'],{type:'video/webm'})}); lateStop();
        assert.equal(outputs.length,0,transition); assert.equal(f.controller.getState().lastCapture,null); assert(f.streams[0].track.stopped); f.controller.dispose();
    }
    const hidden=fixture(),outputs=[]; hidden.controller.onCapture(value=>outputs.push(value));
    const begin=hidden.controller.startRecording(); hidden.controller.afterRender(); await begin; hidden.document.hidden=true; hidden.document.fire('visibilitychange');
    assert.equal(outputs.length,1,'A valid clip ends locally when the tab is hidden.'); assert.equal(hidden.controller.getState().canPhoto,false); hidden.controller.dispose();
});

test('start cancellation, unsupported codecs, failures and hanging stop release every resource', async () => {
    const cancel=fixture(),start=cancel.controller.startRecording(); assert.equal(await cancel.controller.stopRecording(),null); await assert.rejects(start,{name:'AbortError'}); assert.equal(cancel.timers.size,0); cancel.controller.dispose();
    for(const kind of ['noRecorder','noStream']) {
        const f=fixture({[kind]:true}); await assert.rejects(f.controller.startRecording(),/Vídeo no disponible/); assert.equal(f.controller.getState().canPhoto,true); f.controller.dispose();
    }
    const timed=fixture(),waiting=timed.controller.startRecording(); timed.advance(5001); await assert.rejects(waiting,/fotograma/); assert.equal(timed.buffers[0].width,1); timed.controller.dispose();
    for(const kind of ['recorderThrows','startThrows','unexpectedAudio']) {
        const f=fixture({[kind]:true}),pending=f.controller.startRecording(); f.controller.afterRender(); await assert.rejects(pending); assert(f.streams.every(row=>row.getTracks().every(track=>track.stopped))); assert.equal(f.timers.size,0); f.controller.dispose();
    }
    const hanging=fixture({hangStop:true}),begun=hanging.controller.startRecording(); hanging.controller.afterRender(); await begun;
    const ended=hanging.controller.stopRecording(); hanging.advance(10001); await assert.rejects(ended,/finalizar/); assert(hanging.streams[0].track.stopped); hanging.controller.dispose();
    const empty=fixture({emptyVideo:true}),started=empty.controller.startRecording(); empty.controller.afterRender(); await started; await assert.rejects(empty.controller.stopRecording(),/vídeo válido/); empty.controller.dispose();
});

test('context callbacks, event cleanup and unsupported XR remain explicit, without media permissions', async () => {
    const f=fixture(); assert.equal(f.source().listenerCount(),2); assert.equal(f.document.listenerCount(),1); assert.equal(f.window.listenerCount(),1);
    f.setContext({xr:true}); f.controller.afterRender(); await assert.rejects(f.controller.capturePhoto(),/Sal de RV/); await assert.rejects(f.controller.startRecording(),/Sal de RV/);
    f.setContext({xr:false}); f.controller.afterRender(); assert.equal(f.controller.getState().canPhoto,true);
    f.source().fire('webglcontextlost',{preventDefault(){}}); assert.equal(f.controller.getState().canPhoto,false); f.source().fire('webglcontextrestored'); assert.equal(f.controller.getState().canPhoto,true);
    const source=f.source(); f.window.fire('pagehide'); assert.equal(source.listenerCount(),0); assert.equal(f.document.listenerCount(),0); assert.equal(f.window.listenerCount(),0); assert.equal(f.controller.getState().phase,'disposed');
    assert.equal(f.window.navigator,undefined,'No hardware media API is accessed.');
});

test('BFCache cancels pending output without leaving a resumed live scene with a disposed controller', async () => {
    const f=fixture({deferBlob:true}),outputs=[];f.controller.onCapture(value=>outputs.push(value));
    const photo=f.controller.capturePhoto();f.controller.afterRender();const epoch=f.controller.getState().epoch;
    f.window.fire('pagehide',{persisted:true});await assert.rejects(photo,{name:'AbortError'});f.encoders[0].callback(new Blob(['stale cached frame'],{type:'image/png'}));
    assert.equal(f.controller.getState().phase,'idle');assert(f.controller.getState().epoch>epoch);assert.equal(outputs.length,0);assert.equal(f.document.listenerCount(),1);assert.equal(f.window.listenerCount(),1);
    const next=f.controller.capturePhoto();f.controller.afterRender();f.encoders[1].callback(new Blob(['resumed frame'],{type:'image/png'}));assert.equal(await (await next).blob.text(),'resumed frame');assert.equal(outputs.length,1);
    f.window.fire('pagehide',{persisted:false});assert.equal(f.controller.getState().phase,'disposed');assert.equal(f.window.listenerCount(),0);
});

test('recording allocation failures release detached canvases and do not leave a preparing job', async () => {
    const f=fixture({no2d:true});await assert.rejects(f.controller.startRecording(),/No se pudo capturar/);assert.equal(f.controller.record,null);assert.equal(f.controller.getState().phase,'idle');assert.equal(f.buffers[0].width,1);assert.equal(f.buffers[0].height,1);assert.equal(f.timers.size,0);f.controller.dispose();
    const timer=fixture();timer.window.setTimeout=()=>{throw Error('Timer cannot be scheduled.');};await assert.rejects(timer.controller.startRecording(),/No se pudo capturar/);assert.equal(timer.controller.record,null);assert.equal(timer.controller.getState().phase,'idle');assert.equal(timer.buffers[0].width,1);assert.equal(timer.streams.length,0);timer.controller.dispose();
});
