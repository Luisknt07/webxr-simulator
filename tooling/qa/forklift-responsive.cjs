'use strict';
// Real browser geometry of the production HUD and mission view; transient fixtures only.
// The layout/camera imagery is synthetic: this checks controls and CSS, not GPU rendering.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {randomBytes, createHash} = require('node:crypto');
const {startFixture, withBrowser} = require('./workspace-production.cjs');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'data/qa-forklift-responsive');
const CSS_FILES = ['packages/tools/editor/src/editor.css', 'apps/public-viewer/viewer.css'];
const VIEWPORTS = [[1600,900,false], [1920,1080,false], [2560,1440,false], [897,1378,false], [390,844,true], [844,390,true], [667,375,true]];
const load = name => fs.readFileSync(path.join(ROOT, 'modules/logistica-industrial/functions/montacargas/runtime', name), 'utf8').replace(/^import .*;\r?\n/gm, '');
const source = (name, symbol) => load(name).replace('export default class ' + symbol, 'return class ' + symbol);
const sources = {guide:source('VehicleControlGuide.js','VehicleControlGuide'), driving:source('VehicleDriving.js','VehicleDriving'), mission:source('VehicleMissionPanel.js','VehicleMissionPanel')};
sources.devices=fs.readFileSync(path.join(ROOT,'packages/input-devices/InputDevicePanel.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class InputDevicePanel','return class InputDevicePanel');
sources.input=fs.readFileSync(path.join(ROOT,'packages/input-devices/GamepadInput.js'),'utf8').replace('export default class GamepadInput','class GamepadInput').replace(/^export /gm,'')+'\nreturn {GamepadInput,GAMEPAD_ACTIONS,STANDARD_BINDINGS};';
sources.inputCSS=fs.readFileSync(path.join(ROOT,'packages/input-devices/input-device.css'),'utf8');
const intersection = (a, b) => Math.max(0, Math.min(a.right,b.right)-Math.max(a.x,b.x)) * Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y));
const inRect = (inner, outer) => inner.x >= outer.x-1 && inner.y >= outer.y-1 && inner.right <= outer.right+1 && inner.bottom <= outer.bottom+1;
const digest = value => createHash('sha256').update(value).digest('hex');

function createFixture({css, sources}) {
  document.open();
  document.write('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body style="margin:0;background:linear-gradient(130deg,#79827b,#a4aaa1 65%,#5f6f71);height:100dvh"><button id="editor-return" style="position:fixed;left:10px;top:90px">Volver al editor</button></body></html>');
  document.close();
  const Guide = new Function(sources.guide)();
  const Driving = new Function('THREE', 'VehicleControlGuide', sources.driving)({Vector3:class{}}, Guide);
  const Mission = new Function(sources.mission)();
  const d = Object.create(Driving.prototype);
  Object.assign(d, {document, window, listeners:[], id:'vehicle', touches:new Map(), ctx:{}, command:action=>{window.__commands.push(action);return true;}, resetInput(){this.touches.clear();}, blocked:()=>false});
  window.__commands = []; d.buildHUD();
  const supported = new Set(Guide.definitions({forks:true,lift:true,sideShift:true,tilt:true}, {maxTowKg:0}).map(row=>row.action));
  for (const [key,button] of d.controlButtons) button.hidden = !supported.has(key);
  d.applyControlSections();
  d.status.textContent='Aprendizaje almacén · montacargas manual';
  d.telemetry.textContent='0.00 m/s · Altura 0.00 m · Carga 0 kg';
  d.phase.textContent='En marcha · Freno P activo';
  d.guideTitle.textContent='Freno de estacionamiento activo';
  d.guideText.textContent='Comprueba que el pasillo esté libre y libera el freno para desplazarte.';
  const root=document.createElement('div'); root.id='vehicle-operation-panels';
  const column=document.createElement('div'); column.className='vehicle-operator-column'; root.append(column); document.body.append(root); column.append(d.hud);
  const guidance=document.createElement('section'); guidance.className='vehicle-guidance-panel'; guidance.dataset.training='active'; column.prepend(guidance);
  // Match VehicleDockingMonitor's desktop mission default; shared mission views
  // elsewhere intentionally retain their own compact default.
  const panel=new Mission(document,{expanded:innerWidth>=1440&&innerHeight>=800}); panel.mount(guidance);
  panel.update({title:'Retirar WH-001 del nivel superior y entregar en SALIDA S01',taskId:'first',stage:'approach',phase:'pickup',stageTitle:'Acércate al pallet',instruction:'Acércate al pallet asignado; las flechas orientan el recorrido de recogida.',score:0,scoreMax:495,total:3,completed:0});
  const bar=document.createElement('div'); bar.className='vehicle-guidance-controls';
  bar.innerHTML='<button type="button">Holograma ON · Shift+G</button><label class="vehicle-guidance-target">Objetivo<select aria-label="Lugar donde recoger o descargar el pallet"><option>Recoger · Aprendizaje almacén · WH-001</option></select></label>';
  guidance.append(bar);
  const navigation=document.createElement('section'); navigation.className='vehicle-docking-monitor vehicle-navigation-display'; navigation.dataset.display='layout'; navigation.dataset.expanded='false'; navigation.dataset.plan='open';
  navigation.innerHTML='<div class="vehicle-navigation-header"><strong class="vehicle-navigation-title">Plano de la instalación</strong><div class="vehicle-navigation-actions"><button>Cámara auto</button><button>Plano</button><button>Retrovisor</button><button>⛶ Ampliar</button></div></div><div class="vehicle-docking-body"><section class="vehicle-docking-plan"><canvas width="1024" height="576"></canvas></section><section class="vehicle-fork-camera"><div class="vehicle-fork-camera-header"><button>Vista: Isométrica · Shift+C</button><button>Lado: Izq. · Shift+N</button></div><div class="vehicle-camera-views"><div class="vehicle-fork-camera-viewport"><canvas width="1024" height="576" style="display:block;width:100%;height:100%;object-fit:contain"></canvas></div></div></section></div><p class="vehicle-docking-summary">Recoger: A01-R01-B01-N02-P01</p><p class="vehicle-docking-metrics" hidden>Lateral: −3.2 cm · Altura: 0.5 cm · Inserción: 53 cm</p>';
  root.append(navigation);
  const c=navigation.querySelector('.vehicle-docking-plan canvas'), g=c.getContext('2d');
  g.fillStyle='#142a35'; g.fillRect(0,0,1024,576); g.strokeStyle='#6b9399'; g.lineWidth=4; g.strokeRect(100,60,820,450); g.strokeStyle='#65d2d7'; g.beginPath(); g.moveTo(800,450); g.lineTo(800,180); g.lineTo(200,180); g.stroke();
  const camera=navigation.querySelector('.vehicle-fork-camera-viewport canvas'), cg=camera.getContext('2d');
  cg.fillStyle='#607777';cg.fillRect(0,0,1024,576);cg.fillStyle='#c4ac75';cg.fillRect(180,210,680,90);cg.fillRect(180,370,680,55);cg.fillRect(180,300,75,70);cg.fillRect(480,300,75,70);cg.fillRect(785,300,75,70);cg.fillStyle='#c5d1d7';cg.fillRect(290,325,120,240);cg.fillRect(610,325,120,240);
  const {GamepadInput,GAMEPAD_ACTIONS,STANDARD_BINDINGS}=new Function(sources.input)(),DevicePanel=new Function('GAMEPAD_ACTIONS','STANDARD_BINDINGS',sources.devices)(GAMEPAD_ACTIONS,STANDARD_BINDINGS);
  const pad={id:'PlayStation DualSense QA',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
  const input=new GamepadInput({navigator:{getGamepads:()=>[pad]},now:()=>Date.now()});input.poll({active:false,selectedVehicleId:'vehicle'});
  const devices=new DevicePanel({document,window,input,onOpen:()=>{window.__devicePanelOpen=true;d.resetInput();},onClose:()=>{window.__devicePanelOpen=false;d.resetInput();}});devices.mount(d.hud.querySelector('.vehicle-hud-actions'));
  window.__responsive={d,panel,navigation,devices,input};
}

function measure() {
  const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const d=__responsive.d, root=document.getElementById('vehicle-operation-panels'), navigation=__responsive.navigation;
  const center={x:innerWidth*.4,y:innerHeight*.4,width:innerWidth*.2,height:innerHeight*.2,right:innerWidth*.6,bottom:innerHeight*.6};
  const visible=node=>!node.hidden && getComputedStyle(node).display!=='none';
  const contentBottom=Math.max(...[...d.hud.children].map(node=>node.getBoundingClientRect()).filter(box=>box.width>0&&box.height>0).map(box=>box.bottom));
  return {
    viewport:{width:innerWidth,height:innerHeight}, defaultMode:d.hud.dataset.viewport,
    hud:rect(d.hud), mission:rect(__responsive.panel.element), missionExpanded:__responsive.panel.element.dataset.expanded,
    missionInstruction:{rect:rect(__responsive.panel.instruction),visible:getComputedStyle(__responsive.panel.instruction).display!=='none'},
    guidance:rect(root.querySelector('.vehicle-guidance-panel')), map:rect(navigation),
    plan:rect(navigation.querySelector('.vehicle-docking-plan')), camera:rect(navigation.querySelector('.vehicle-fork-camera-viewport')),
    visibleGroups:d.controlGroups.filter(visible).map(node=>node.dataset.group),
    groups:d.controlGroups.filter(visible).map(node=>({group:node.dataset.group,rect:rect(node),columns:getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length,headingVisible:getComputedStyle(node.heading).display!=='none'})),
    buttons:d.controlGroups.filter(visible).flatMap(group=>group.controls.filter(visible).map(button=>({action:button.dataset.vehicleAction,rect:rect(button),labelOverflow:button.controlLabel.scrollWidth>button.controlLabel.clientWidth+1}))),
    hudScrolls:d.hud.scrollHeight>d.hud.clientHeight+1,
    hudClientHeight:d.hud.clientHeight,hudScrollHeight:d.hud.scrollHeight,hudScrollPixels:Math.max(0,d.hud.scrollHeight-d.hud.clientHeight),
    hudBlankPixels:Math.max(0,d.hud.getBoundingClientRect().bottom-contentBottom-parseFloat(getComputedStyle(d.hud).paddingBottom||0)),
    touchTargets:[...d.hud.querySelectorAll('button'),__responsive.panel.expandButton,...navigation.querySelectorAll('button')].map(node=>({label:node.textContent,hidden:node.hidden,rect:rect(node)})).filter(row=>!row.hidden&&row.rect.width>0&&row.rect.height>0),
    sampleButton:(()=>{const button=d.controlButtons.get('driveForward'),style=getComputedStyle(button),label=getComputedStyle(button.controlLabel),key=getComputedStyle(button.querySelector('.vehicle-control-key'));return {rect:rect(button),rows:style.gridTemplateRows,padding:style.padding,lineHeight:style.lineHeight,labelHeight:rect(button.controlLabel).height,labelLineHeight:label.lineHeight,keyHeight:rect(button.querySelector('.vehicle-control-key')).height,keyLineHeight:key.lineHeight};})(),
    unsupportedVisible:[...d.controlButtons].filter(([,button])=>button.hidden&&getComputedStyle(button).display!=='none').map(([action])=>action),
    center, centerBlocked:!!document.elementFromPoint(innerWidth*.5,innerHeight*.5).closest('#vehicle-operation-panels'),
    overflow:document.documentElement.scrollWidth>innerWidth
  };
}

function verifyGeometry(result, wide) {
  assert.equal(result.overflow,false,'HUD must not create horizontal page overflow.');
  assert.equal(result.centerBlocked,false,'The default instruments leave the central driving view clear: '+JSON.stringify(result));
  assert.deepEqual(result.unsupportedVisible,[],'Unsupported vehicle controls must stay hidden.');
  for(const name of ['hud','guidance','map']) {
    const r=result[name];
    assert(r.x>=0&&r.right<=result.viewport.width+1&&r.y>=0&&r.bottom<=result.viewport.height+1,JSON.stringify({name,...result}));
  }
  for(const [a,b] of [['hud','guidance'],['hud','map'],['guidance','map']]) assert(intersection(result[a],result[b])<=1,'Default panels must not overlap: '+JSON.stringify({a,b,...result}));
  if(wide) {
    assert.equal(result.defaultMode,'wide');
    assert.deepEqual(result.visibleGroups,['drive','cargo','view','safety']);
    assert(result.hud.width>=320&&result.hud.width<=400,'The left console must remain a narrow vertical instrument.');
    assert(result.hudBlankPixels<=12,'A wide console hugs its controls rather than filling unused vertical space.');
    assert.equal(result.missionExpanded,'true','The wide mission starts expanded above the controls.');
    assert(result.missionInstruction.visible&&inRect(result.missionInstruction.rect,result.guidance),'The mission instruction must be readable.');
    assert(Math.abs(result.hud.x-result.guidance.x)<=1&&Math.abs(result.hud.width-result.guidance.width)<=1,'Mission and controls share one aligned left column.');
    const scrollAllowed=result.viewport.width<2560;
    if(!scrollAllowed) assert.equal(result.hudScrolls,false,'All controls fit without scrolling on the largest desktop.');
    for(let index=0;index<result.groups.length;index++) {
      const group=result.groups[index],previous=result.groups[index-1];
      assert(group.headingVisible);assert.equal(group.columns,4,'Each category uses four compact button columns.');
      if(previous) {assert(Math.abs(previous.rect.x-group.rect.x)<=1&&Math.abs(previous.rect.width-group.rect.width)<=1,'Control categories must stack in one vertical column.');assert(previous.rect.bottom<=group.rect.y+1,'Stacked control categories must not overlap.');}
      if(!scrollAllowed)assert(inRect(group.rect,result.hud),'Control group is clipped: '+group.group);
    }
    for(const button of result.buttons) {if(!scrollAllowed)assert(inRect(button.rect,result.hud),'Control button is clipped: '+button.action);assert.equal(button.labelOverflow,false,'Control label is horizontally clipped: '+button.action);}
    assert(result.map.width>=560&&result.map.width<=740,'The right monitor must remain readable without occupying a large portion of the view.');
    for(const name of ['hud','guidance','map']) assert(intersection(result[name],result.center)<=1,'Wide instruments must leave the central driving corridor clear: '+name);
  } else {
    assert.deepEqual(result.visibleGroups,['drive']);
    assert(result.hud.height<=Math.min(300,result.viewport.height*.65));
    if(result.viewport.width<=900)for(const target of result.touchTargets)assert(target.rect.height>=43.9,'A touch target needs44px: '+target.label);
  }
}

async function run() {
  fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
  const report={startedAt:new Date().toISOString(),syntheticImagery:true,temporaryDataOnly:true,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],viewports:[],sourceSha256:{driving:digest(sources.driving)}};
  const fixture=await startFixture('Disposable-'+randomBytes(12).toString('hex'));
  try {
    await withBrowser(fixture,report,async b=>{
      for(const file of CSS_FILES) {
        const css=fs.readFileSync(path.join(ROOT,file),'utf8'); report.sourceSha256[file]=digest(css);
        for(const [width,height,mobile] of VIEWPORTS) {
          const wide=width>=1440&&height>=800;
          await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
          await b.send('Page.navigate',{url:'about:blank'});await b.call(createFixture,{css:css+'\n'+sources.inputCSS,sources});
          const result=await b.call(measure); report.currentCase={file,width,height,state:'layout',...result};verifyGeometry(result,wide);
          if(wide&&result.hudScrolls) {
            const reachable=await b.call(()=>{const hud=__responsive.d.hud;hud.scrollTop=hud.scrollHeight;const buttons=[...hud.querySelectorAll('[data-vehicle-action]')].filter(node=>!node.hidden),last=buttons.at(-1),a=last.getBoundingClientRect(),b=hud.getBoundingClientRect();const visible=a.top>=b.top&&a.bottom<=b.bottom+1;hud.scrollTop=0;return visible;});
            assert(reachable,'A bounded console scrollbar must reach its final control.');
          }
          const name=(file.startsWith('apps/')?'public':'workspace')+'-'+width+'x'+height;
          const screenshot=async suffix=>{const shot=await b.send('Page.captureScreenshot',{format:'png'}),filename=path.join(OUT,name+suffix+'.png');fs.writeFileSync(filename,Buffer.from(shot.data,'base64'));report.screenshots.push(filename);};
          await screenshot('');
          // Same production classes must also keep the close-range plan and camera separate.
          await b.call(()=>{const n=__responsive.navigation;n.dataset.display='inspection';n.dataset.camera='on';n.querySelector('.vehicle-navigation-title').textContent='Inspección de carga';n.querySelector('.vehicle-docking-metrics').hidden=false;});
          const inspection=await b.call(measure);report.currentCase={file,width,height,state:'inspection',...inspection};verifyGeometry(inspection,wide);
          assert(inspection.camera.width>0&&inspection.camera.height>0);
          assert(inRect(inspection.camera,inspection.map),'The camera feed must remain inside its display.');
          assert(inRect(inspection.plan,inspection.map),'The alignment plan must remain inside its display.');
          assert(intersection(inspection.plan,inspection.camera)<=1,'The alignment plan must not cover the camera feed.');
          let expanded;
          if(wide) {
            await screenshot('-inspection');
            await b.call(()=>{__responsive.navigation.dataset.expanded='true';});
            expanded=await b.call(measure);report.currentCase={file,width,height,state:'inspection-expanded',...expanded};
            const bounds={x:0,y:0,right:width,bottom:height};
            assert(expanded.map.width>inspection.map.width+20,'Ampliar must enlarge the wide default camera.');
            assert(inRect(expanded.map,bounds),'Expanded camera must remain within the viewport.');
            assert(inRect(expanded.camera,expanded.map)&&inRect(expanded.plan,expanded.map));
            assert(intersection(expanded.plan,expanded.camera)<=1);
            await screenshot('-inspection-expanded');
            await b.call(()=>{__responsive.navigation.dataset.expanded='false';});
          }
          // GPU inspection is composited under the DOM, unlike the synthetic
          // canvas here: an opaque ancestor would darken or conceal its image.
          const compositing=await b.call(()=>{const n=__responsive.navigation,previous={operation:n.dataset.operation,expanded:n.dataset.expanded};n.dataset.operation='drop';n.dataset.expanded='true';const rows=[];for(let node=n.querySelector('.vehicle-fork-camera-viewport');node&&node!==document.body;node=node.parentElement){const s=getComputedStyle(node);rows.push({className:node.className,background:s.backgroundColor,image:s.backgroundImage});}if(previous.operation===undefined)delete n.dataset.operation;else n.dataset.operation=previous.operation;n.dataset.expanded=previous.expanded;return rows;});
          for(const surface of compositing){assert(/,\s*0(?:\.0+)?\)$/.test(surface.background),'Expanded GPU camera has an opaque ancestor: '+JSON.stringify(surface));assert.equal(surface.image,'none');}
          // Public free play mounts the desktop mission once, then hides it.
          // Its stale expanded attribute must not put objectives over the
          // portrait unloading toolbar after a viewport change.
          let portraitDrop;
          if(width<=720&&height>560) {
            await b.call(()=>{const r=__responsive,n=r.navigation,g=document.querySelector('.vehicle-guidance-panel');g.dataset.training='';r.panel.element.dataset.expanded='true';r.panel.element.hidden=true;n.dataset.operation='drop';n.querySelector('.vehicle-docking-plan canvas').height=1024;n.querySelector('.vehicle-docking-summary').textContent='Alinea el pallet con la bahía y baja hasta confirmar el apoyo.';n.querySelector('.vehicle-docking-metrics').textContent='Lateral +20.0 cm · Fondo -30.0 cm · Altura +35.0 cm · Giro +11.5° · Apoyo: Sin confirmar';});
            const dropMeasure=()=>{const n=__responsive.navigation,rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return{map:rect(n),header:rect(n.querySelector('.vehicle-navigation-header')),guidance:rect(document.querySelector('.vehicle-guidance-panel')),camera:rect(n.querySelector('.vehicle-fork-camera-viewport')),plan:rect(n.querySelector('.vehicle-docking-plan')),buttons:[...n.querySelectorAll('.vehicle-navigation-actions button')].map(button=>{const r=rect(button);return{rect:r,reachable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button};}),overflow:document.documentElement.scrollWidth>innerWidth};};
            const drop=await b.call(dropMeasure);report.currentCase={file,width,height,state:'portrait-drop',...drop};
            assert.equal(drop.overflow,false);assert(intersection(drop.header,drop.guidance)<=1,'Unloading toolbar must not sit underneath the objectives.');
            for(const button of drop.buttons){assert(button.rect.height>=43.9);assert(button.reachable,'Every unloading toolbar action remains reachable.');}
            assert(drop.camera.width>=200,'Portrait unloading needs a useful camera thumbnail.');assert(inRect(drop.camera,drop.map));assert(intersection(drop.camera,drop.plan)<=1);await screenshot('-drop');
            await b.call(()=>{__responsive.navigation.dataset.expanded='true';});
            const detail=await b.call(dropMeasure);report.currentCase={file,width,height,state:'portrait-drop-expanded',...detail};
            assert(detail.camera.width>=300);assert(inRect(detail.camera,detail.map),'Expanded portrait camera must remain visible.');assert(inRect(detail.plan,detail.map),'Expanded portrait metric plan must remain visible.');
            assert(intersection(detail.header,detail.guidance)<=1);for(const button of detail.buttons)assert(button.reachable);await screenshot('-drop-expanded');
            portraitDrop={default:drop,expanded:detail};
            await b.call(()=>{const r=__responsive,n=r.navigation;n.dataset.expanded='false';delete n.dataset.operation;r.panel.element.hidden=false;r.panel.element.dataset.expanded='false';document.querySelector('.vehicle-guidance-panel').dataset.training='active';n.querySelector('.vehicle-docking-plan canvas').height=576;});
          }
          await b.call(()=>{__responsive.d.controlTabs.get('cargo').click();});assert.equal(await b.evaluate('__responsive.d.controlSection'),'cargo');
          const compact=await b.call(measure);if(wide)assert(compact.hudBlankPixels<=12,'Compact controls cannot leave a tall empty console.');
          await b.call(()=>__responsive.d.minimizeControls.click());const minimized=await b.call(measure);assert.equal(await b.evaluate('__responsive.d.hud.dataset.minimized'),'true');if(wide){assert(minimized.hudBlankPixels<=12);assert(minimized.hud.height<=140,'Minimizing leaves only the console header.');}await b.call(()=>__responsive.d.minimizeControls.click());
          await b.call(()=>__responsive.d.expandControls.click());assert.equal(await b.evaluate('__responsive.d.hud.dataset.expanded'),'true');if(wide)assert((await b.call(measure)).hudBlankPixels<=12);
          await b.call(()=>__responsive.d.expandControls.click());await b.call(()=>__responsive.d.quickEmergency.click());assert.deepEqual(await b.evaluate('__commands'),['emergency']);
          const settings=await b.call(()=>{
            const ui=__responsive.devices,rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};ui.open();let leaked=0;const listener=()=>leaked++;document.addEventListener('keydown',listener);ui.axis.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true,cancelable:true}));document.removeEventListener('keydown',listener);
            const panes=[];for(const tab of ['devices','axes','buttons']){ui.setTab(tab);panes.push({tab,panel:rect(ui.panel),bodyHeight:ui.panel.querySelector('.input-device-body').clientHeight,overflow:ui.panel.scrollWidth>ui.panel.clientWidth+1});}
            ui.setTab('axes');const nodes=ui.focusables();nodes.at(-1).focus();nodes.at(-1).dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));const trapped=document.activeElement===nodes[0];return{leaked,trapped,gate:window.__devicePanelOpen,close:rect(ui.closeButton),panes};
          });
          assert.equal(settings.leaked,0);assert(settings.trapped&&settings.gate);assert(settings.close.width>=44&&settings.close.height>=44);
          for(const pane of settings.panes){assert(inRect(pane.panel,{x:0,y:0,right:width,bottom:height}));assert(pane.bodyHeight>=50);assert.equal(pane.overflow,false);}
          if([1600,390,844,667].includes(width))await screenshot('-settings');
          await b.call(()=>{const ui=__responsive.devices;ui.closeButton.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));});assert.equal(await b.evaluate('!!__responsive.devices.opened||!!window.__devicePanelOpen'),false);
          await b.call(()=>{__responsive.devices.dispose();__responsive.input.dispose();});assert.equal(await b.evaluate('!!document.querySelector(".input-device-overlay")||!!document.querySelector(".input-device-launcher")'),false);
          report.viewports.push({file,width,height,wide,...result,settings,compositing,toggled:{compactHud:compact.hud,compactBlank:compact.hudBlankPixels,minimizedHud:minimized.hud,minimizedBlank:minimized.hudBlankPixels},inspection:{map:inspection.map,plan:inspection.plan,camera:inspection.camera,centerBlocked:inspection.centerBlocked},...(expanded?{expandedInspection:{map:expanded.map,plan:expanded.plan,camera:expanded.camera}}:{}),...(portraitDrop?{portraitDrop}:{})});
        }
      }
    });
    assert.deepEqual(fixture.errors,[]);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);
    delete report.currentCase;report.passed=true;console.log(JSON.stringify({passed:true,viewports:report.viewports.length,wideViewports:report.viewports.filter(row=>row.wide).length,cameraAndLayout:true}));return report;
  } catch(error) {report.passed=false;report.failure=error.stack||String(error);throw error;}
  finally {await fixture.close();report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
