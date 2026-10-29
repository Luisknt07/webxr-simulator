const __layout = require("../layout.cjs");
'use strict';
// Offline asset preparation only. One disposable HTTPS server and Chrome
// profile; no live account/database, no rendering workload in the visitor UI.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer} = require('../qa/qa-project-workspace-browser');
const {withBrowser} = require('../qa/qa-public-publication-browser');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/generate-scene-thumbnails.js"), '..')), DIRECTORY = __layout.map(path.join(ROOT, "assets/scene-thumbnails")), WIDTH = 480, HEIGHT = 320, RECIPE_VERSION = 2;
const photograph = scene => !scene.templateId || scene.id === 'forklift-training';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function png(bytes) {
  assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'Thumbnail must be a real PNG.');
  assert.equal(bytes.toString('ascii',12,16),'IHDR'); assert.equal(bytes.readUInt32BE(16),WIDTH); assert.equal(bytes.readUInt32BE(20),HEIGHT);
  assert(bytes.length > 1000 && bytes.length < 750000, 'Thumbnail has a bounded, non-empty encoded image.'); return bytes;
}
async function inspect(browser, base64) {
  return browser.call(async data => {
    const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
    const context2d = canvas.getContext('2d'); context2d.drawImage(image,0,0,32,24); const pixels = context2d.getImageData(0,0,32,24).data;
    let total=0,squared=0,min=255,max=0; for(let index=0;index<pixels.length;index+=4){const value=(pixels[index]+pixels[index+1]+pixels[index+2])/3;total+=value;squared+=value*value;min=Math.min(min,value);max=Math.max(max,value);}
    const count=pixels.length/4,mean=total/count,width=image.naturalWidth,height=image.naturalHeight; image.removeAttribute('src'); return {width,height,mean,variance:squared/count-mean*mean,min,max};
  }, base64);
}
async function generate(options = {}) {
  const bundleSha256 = digest(fs.readFileSync(__layout.map(path.join(ROOT,"bundle.js"))));
  if(options.expected)assert.equal(bundleSha256,options.expected,'Build the reviewed application before generating its images.');
  const catalog = JSON.parse(fs.readFileSync(__layout.map(path.join(ROOT,"projects/smarttwin/scenes/catalog.json")),'utf8'));
  const ids = new Set(catalog.scenes.map(scene=>scene.id)); assert.equal(ids.size,catalog.scenes.length);
  catalog.scenes.forEach(scene=>assert(/^[a-z0-9-]{1,80}$/.test(scene.id)));
  let selected = options.only ? options.only.split(',') : Array.from(ids); selected.forEach(id=>assert(ids.has(id),'Scene is not in the bundled public catalog: '+id));
  fs.mkdirSync(DIRECTORY,{recursive:true}); fs.mkdirSync(__layout.map(path.join(ROOT,'data/qa-studio')),{recursive:true});
  const oldFile=__layout.map(path.join(DIRECTORY,'manifest.json')),previous=fs.existsSync(oldFile)?JSON.parse(fs.readFileSync(oldFile,'utf8')):{scenes:[]};
  const rows=new Map((previous.scenes||[]).filter(row=>ids.has(row.id)).map(row=>[row.id,row]));
  if(options.missing)selected=selected.filter(id=>{const row=rows.get(id),file=__layout.map(path.join(DIRECTORY,id+'.png'));return !row||!fs.existsSync(file)||row.recipeVersion!==RECIPE_VERSION||row.bundleSha256!==bundleSha256||row.sceneSha256!==digest(fs.readFileSync(__layout.map(path.join(ROOT,"assets/public-scenes",id+'.json'))));});
  const checkpoint=()=>{
    const scenes=catalog.scenes.map(scene=>rows.get(scene.id)).filter(Boolean),bytes=scenes.reduce((sum,row)=>sum+row.bytes,0);assert(bytes<=8*1024*1024,'The entire offline gallery stays below8MiB encoded.');
    const manifest={format:'hello-webxr-scene-thumbnails',version:1,recipeVersion:RECIPE_VERSION,width:WIDTH,height:HEIGHT,bundleSha256,catalogSha256:digest(fs.readFileSync(__layout.map(path.join(ROOT,"projects/smarttwin/scenes/catalog.json")))),complete:scenes.length===catalog.scenes.length,bytes,scenes};
    fs.writeFileSync(oldFile,JSON.stringify(manifest,null,2)+'\n');return manifest;
  };
  if(!selected.length)return checkpoint();
  const fixture=await startTemporaryServer();
  try {
    await withBrowser(fixture.origin,async browser=>{
      // A public projection in the editor route provides the existing private
      // thumbnail factory without authenticating or creating a saved project.
      await browser.navigate('/editor?scene=l-transfer');
      await browser.call(()=>{
        const editor=context.editor; editor.simulationPaused=true; context.studio.close();
        editor.shell.openSceneCatalog('included'); const thumbnails=editor.shell.sceneCatalog.thumbnails;
        thumbnails.reset(); const renderer=thumbnails._getRenderer(); renderer.setSize(480,320,false);
        const render=renderer.render.bind(renderer);renderer.render=(scene,camera)=>{camera.zoom=1.6;camera.updateProjectionMatrix();return render(scene,camera);};
        window.__offlineSceneThumbnails=thumbnails;
      });
      browser.report.thumbnailResources=[];
      for(const scene of catalog.scenes.filter(scene=>selected.includes(scene.id)&&!photograph(scene))) {
        const result=await browser.call(async definition=>{
          const thumbnails=window.__offlineSceneThumbnails;
          const image=await thumbnails._model({path:'included:'+definition.templateId,kind:'model',extension:'3d'},thumbnails.generation);
          if(!image.src||!image.src.startsWith('data:image/png;base64,'))throw Error('No actual model preview for '+definition.id);
          return {data:image.src.slice('data:image/png;base64,'.length),geometries:thumbnails.renderer.info.memory.geometries,textures:thumbnails.renderer.info.memory.textures};
        },scene);
        const bytes=png(Buffer.from(result.data,'base64')),quality=await inspect(browser,result.data);
        assert(quality.max-quality.min>8&&quality.variance>3,'The actual scene preview must not be blank: '+scene.id);
        assert(result.geometries<=2&&result.textures<=2,'Detached preview resources were not released: '+scene.id);
        browser.report.thumbnailResources.push({id:scene.id,geometries:result.geometries,textures:result.textures});
        fs.writeFileSync(__layout.map(path.join(DIRECTORY,scene.id+'.png')),bytes);
        rows.set(scene.id,{id:scene.id,title:scene.name,file:scene.id+'.png',method:'actual-study-factory',recipeVersion:RECIPE_VERSION,width:WIDTH,height:HEIGHT,bytes:bytes.length,sha256:digest(bytes),bundleSha256,sceneSha256:digest(fs.readFileSync(__layout.map(path.join(ROOT,"assets/public-scenes",scene.id+'.json')))),quality});
        checkpoint();
        console.log('Prepared '+scene.id+': '+bytes.length+' bytes');
      }
      await browser.call(()=>{context.editor.shell.sceneCatalog.close();delete window.__offlineSceneThumbnails;});
      // Native museum/panorama scenes and the full laboratory are photographed
      // from their real public world, never substituted with illustrative art.
      await browser.send('Emulation.setDeviceMetricsOverride',{width:960,height:640,deviceScaleFactor:1,mobile:false});
      for(const scene of catalog.scenes.filter(scene=>selected.includes(scene.id)&&photograph(scene))) {
        // Fresh public navigation gives each native experience its own real
        // entry pose and releases the previous page's decoder/render resources.
        await browser.navigate('/?scene='+encodeURIComponent(scene.id));
        await browser.call(()=>{context.editor.simulationPaused=true;context.studio.close();});
        await browser.until(()=>browser.evaluate('!context.editor.loadingProject&&!context.roomTransition&&!context.roomTransitionView.active'),'Public image world did not settle: '+scene.id,180000);
        if(scene.id==='original-sound')await browser.until(()=>browser.evaluate('(()=>{const bells=context.assets.sound_model.scene.getObjectByName("bells");return bells&&bells.visible&&bells.children.some(child=>child.scale.x>.8)})()'),'The native first instrument did not enter its real animation.',15000);
        await browser.call(id=>{
          let style=document.getElementById('offline-scene-thumbnail-style');if(!style){style=document.createElement('style');style.id='offline-scene-thumbnail-style';document.head.appendChild(style);}
          style.textContent='.studio-header,.studio-notice,.studio-context,.studio-widgets,.studio-controls,.studio-shade,.studio-drawer,#desktop-reticle,#editor-launcher,#editor-return,#simulation-launcher,.ed-preview-controls,.vehicle-driving-hud,.vehicle-docking-monitor{display:none!important}';
          if(id==='industrial-lab-complete'){
            context.cameraRig.position.set(28,0,38);context.cameraRig.quaternion.set(0,0,0,1);context.camera.position.set(0,5.8,0);context.cameraRig.updateWorldMatrix(true,true);context.camera.lookAt(-15,1,0);context.resetCollisionPose?.();
          }else if(id==='forklift-training'){
            context.cameraRig.position.set(-17,0,32);context.cameraRig.quaternion.set(0,0,0,1);context.camera.position.set(0,3.2,0);context.camera.fov=55;context.camera.updateProjectionMatrix();context.cameraRig.updateWorldMatrix(true,true);context.camera.lookAt(-24,1,28);context.resetCollisionPose?.();
          }else if(id==='original-sound'){
            // The room is a 360-degree sequence: its first instrument appears
            // behind the portal entry only after its native two-second timer.
            // Photograph that actual animation, not an empty initial frame.
            context.cameraRig.position.set(1,0,-1.3);context.cameraRig.quaternion.set(0,0,0,1);context.camera.position.set(0,1.6,0);context.camera.fov=35;context.camera.updateProjectionMatrix();context.cameraRig.updateWorldMatrix(true,true);context.camera.lookAt(-.22,1.05,-3.69);context.resetCollisionPose?.();
          }
          const ray=context.raycontrol&&context.raycontrol.raycasterContext;if(ray)ray.visible=false;
        },scene.id);
        await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const capture=await browser.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:960,height:640,scale:.5},captureBeyondViewport:false});
        const bytes=png(Buffer.from(capture.data,'base64')),quality=await inspect(browser,capture.data);
        if(!(quality.max-quality.min>8&&quality.variance>3))fs.writeFileSync(__layout.map(path.join(ROOT,'data/qa-studio/scene-thumbnail-failed-'+scene.id+'.png')),bytes);
        assert(quality.max-quality.min>8&&quality.variance>3,'The public-world photograph must not be blank: '+scene.id+' '+JSON.stringify(quality));
        fs.writeFileSync(__layout.map(path.join(DIRECTORY,scene.id+'.png')),bytes);
        rows.set(scene.id,{id:scene.id,title:scene.name,file:scene.id+'.png',method:'actual-public-world',recipeVersion:RECIPE_VERSION,width:WIDTH,height:HEIGHT,bytes:bytes.length,sha256:digest(bytes),bundleSha256,sceneSha256:digest(fs.readFileSync(__layout.map(path.join(ROOT,"assets/public-scenes",scene.id+'.json')))),quality});
        checkpoint();
        console.log('Photographed '+scene.id+': '+bytes.length+' bytes');
      }
      assert.deepEqual(browser.report.exceptions,[]);assert.deepEqual(browser.report.consoleErrors,[]);assert.deepEqual(browser.report.apiFailures,[]);assert.deepEqual(browser.report.writes,[]);
      browser.report.bundleSha256=bundleSha256;browser.report.thumbnailCount=rows.size;fs.writeFileSync(__layout.map(path.join(ROOT,'data/qa-studio/scene-thumbnail-generation.json')),JSON.stringify(browser.report,null,2));
    });
    assert.deepEqual(fixture.errors,[]);assert.deepEqual(fixture.writes,[]);
  } finally {await fixture.close();}
  if(!options.only)assert.equal(rows.size,catalog.scenes.length,'Every allowed bundled scene needs its own real preview.');
  return checkpoint();
}
if(require.main===module){const args=process.argv.slice(2),arg=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};generate({expected:arg('--expected-bundle-sha256'),only:arg('--only'),missing:args.includes('--missing')}).then(result=>console.log('Scene images: '+result.scenes.length+' / '+result.bytes+' bytes.')).catch(error=>{console.error(error);process.exitCode=1;});}
module.exports={generate,png};
