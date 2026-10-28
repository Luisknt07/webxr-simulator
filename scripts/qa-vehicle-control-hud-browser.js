'use strict';
// The public forklift example supplies the real HUD and runtime. Mounting the
// first forklift is fixture setup; screenshots/layout and native button input
// below do not certify headset ergonomics or replace the driving physics QA.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer} = require('./qa-project-workspace-browser'), {withBrowser} = require('./qa-public-publication-browser');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
async function verifyHUD(browser) {
  const stage=name=>{browser.report.hudStage=name;console.log('Vehicle HUD QA: '+name);};
  browser.report.graphicsFixture='Disposable software-GPU layout QA: balanced mode, fixed tier1; adaptive graphics tick disabled.';
  stage('desktop loading');
  await browser.navigate('/?scene=forklift-training');
  await browser.until(() => browser.evaluate('!context.roomTransition&&!context.roomTransitionView.active&&context.editor.simulation?.running'), 'The public forklift example did not settle.');
  const mount = () => browser.call(() => {
    context.studio.close(); const editor = context.editor;
    const graphics=context.graphics;graphics.setMode('balanced');graphics.tier=1;graphics.tick=()=>graphics.getStats();graphics.applyDesktopRatio();
    const record = Array.from(editor.simulation.records.values()).find(value => value.components.vehicle && !['cart', 'tow'].includes(value.components.vehicle.config.family));
    if (!record) throw Error('The public example has no forklift.');
    if (!editor.vehicleDriving.mount(record.id)) throw Error('Cannot mount the public forklift fixture.');
    window.__qaHUDVehicle = record.id;
    window.__qaHUDClicks = []; document.addEventListener('click', event => {
      const button = event.target.closest && event.target.closest('[data-vehicle-command]');
      if (button) __qaHUDClicks.push({action: button.dataset.vehicleCommand, trusted: event.isTrusted});
    }, true);
  });
  await mount();
  stage('desktop mounted');
  await browser.until(() => browser.evaluate('!!document.querySelector(".vehicle-next-step")&&!context.editor.vehicleDriving.hud.hidden'), 'The grouped vehicle HUD is unavailable.');
  const settle = () => browser.call(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => requestAnimationFrame(resolve)); });
  await settle();
  const snapshot = () => browser.call(() => {
    const hud = context.editor.vehicleDriving.hud, rect = hud.getBoundingClientRect(), css = getComputedStyle(hud);
    const bound = node => {const r = node.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const dock = document.querySelector('.vehicle-docking-monitor'), docking = dock && !dock.hidden && dock.getClientRects().length ? bound(dock) : null;
    const visible = node => !node.closest('details:not([open])') && !!node.getClientRects().length;
    return {viewport:{width:innerWidth,height:innerHeight},hud:bound(hud),zIndex:css.zIndex,scrollWidth:hud.scrollWidth,clientWidth:hud.clientWidth,
      nextStep:hud.querySelector('.vehicle-next-step-text')?.textContent,
      groups:[...hud.querySelectorAll('.vehicle-control-group')].map(group=>({name:group.querySelector('.vehicle-control-group-title')?.textContent,visible:visible(group),columns:getComputedStyle(group).gridTemplateColumns})),
      recommendations:[...hud.querySelectorAll('button[data-recommended="true"]')].map(button=>({action:button.dataset.vehicleCommand,visible:visible(button),animation:getComputedStyle(button).animationName,key:button.querySelector('.vehicle-control-key')?.textContent})),
      buttons:[...hud.querySelectorAll('[data-vehicle-command]')].map(button=>{const label=button.querySelector('span'),key=button.querySelector('.vehicle-control-key'),range=label&&document.createRange();if(range)range.selectNodeContents(label);return {action:button.dataset.vehicleCommand,label:button.textContent,key:key?.textContent,visible:visible(button),scrollWidth:button.scrollWidth,clientWidth:button.clientWidth,labelRight:range?.getBoundingClientRect().right,keyLeft:key?.getBoundingClientRect().left};}),
      help:[...hud.querySelectorAll('details')].map(details=>({title:details.querySelector('summary')?.textContent,open:details.open})),docking};
  });
  function checkLayout(value, mobile = false) {
    assert.equal(value.zIndex,'32'); assert(value.hud.left>=0&&value.hud.right<=value.viewport.width+1,'HUD exceeds the viewport.');
    assert(value.hud.height<=value.viewport.height*.45+1,'Vehicle controls must stay within the lower45% of the view.');
    assert(value.scrollWidth<=value.clientWidth+1,'Vehicle controls overflow horizontally.');
    assert(value.nextStep&&value.nextStep.trim(),'A readable next action must remain visible.');
    assert(value.groups.length>=4,'The complete controls must be separated into functional groups.');
    assert(value.buttons.some(button=>button.action==='powerOn'&&button.key),'Power-on must show its actual keyboard shortcut.');
    value.buttons.filter(button=>button.visible).forEach(button=>assert(button.scrollWidth<=button.clientWidth+1,'A control label or key escapes its button: '+button.action));
    value.buttons.filter(button=>button.visible&&Number.isFinite(button.labelRight)&&Number.isFinite(button.keyLeft)).forEach(button=>assert(button.labelRight<=button.keyLeft-1,'A control label overlaps its shortcut: '+button.action));
    assert(value.help.length&&value.help.some(help=>help.title),'Secondary help belongs in a labeled disclosure.');
    value.recommendations.forEach(button=>assert.equal(button.animation,'none','Recommended controls must not blink.'));
    if(mobile&&value.docking)assert(value.docking.bottom<=value.hud.top+1,'Mobile forklift controls overlap the alignment guide.');
  }
  const mouseClick = async selector => {
    const point = await browser.call(query => {
      const element = context.editor.vehicleDriving.hud.querySelector(query); if(!element||element.disabled)throw Error('Missing HUD control: '+query);
      element.scrollIntoView({block:'nearest',inline:'nearest'}); const r=element.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,top=document.elementFromPoint(x,y);
      if(!r.width||!r.height||!top||top!==element&&!element.contains(top))throw Error('HUD click is obscured: '+query);
      return {x,y};
    }, selector);
    await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await settle();
  };
  const desktop=await snapshot();checkLayout(desktop);assert(desktop.help.every(help=>!help.open),'Secondary controls should start collapsed.');
  await browser.screenshot('vehicle-hud-desktop');
  await mouseClick('.vehicle-driving-help summary');
  const expanded=await snapshot();checkLayout(expanded);assert(expanded.help.some(help=>help.open),'The native help click did not expand secondary controls.');
  assert(expanded.groups.filter(group=>group.visible).length>desktop.groups.filter(group=>group.visible).length,'Opening all controls should reveal the secondary groups.');
  await browser.screenshot('vehicle-hud-expanded');
  await browser.call(()=>{const hud=context.editor.vehicleDriving.hud;hud.scrollTop=hud.scrollHeight;});await settle();await browser.screenshot('vehicle-hud-secondary');stage('desktop and secondary labels passed');
  const vehicleState = () => browser.call(()=>{const value=context.editor.simulation.records.get(__qaHUDVehicle).components.vehicle;return {powered:value.powered,running:value.running,parkingBrake:value.parkingBrake,emergency:value.emergency};});
  // Trusted mouse input verifies the labeled power control still reaches the
  // actual public runtime. Initial state is read rather than assumed.
  const initial=await vehicleState();
  if(initial.powered){await mouseClick('[data-vehicle-command="powerOff"]');await browser.until(async()=>!(await vehicleState()).powered,'Native power-off did not reach the vehicle.');}
  await browser.call(()=>{context.editor.vehicleDriving.hud.scrollTop=0;});await settle();await browser.screenshot('vehicle-hud-poweroff');
  await mouseClick('[data-vehicle-command="powerOn"]');await browser.until(async()=>Boolean((await vehicleState()).powered),'The native power control did not reach the vehicle.');
  await mouseClick('[data-vehicle-command="start"]');await browser.until(async()=>Boolean((await vehicleState()).running),'The native run control did not reach the vehicle.');
  if((await vehicleState()).parkingBrake){await mouseClick('[data-vehicle-command="parkingBrake"]');await browser.until(async()=>!(await vehicleState()).parkingBrake,'Native parking-brake release did not reach the vehicle.');}
  const after=await vehicleState();
  stage('trusted power/run/parking clicks passed');
  await mouseClick('.vehicle-driving-help summary');
  const desktopClicks=await browser.evaluate('__qaHUDClicks');
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await browser.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  // Reload after changing mobile metrics. Chrome can otherwise preserve the
  // desktop layout viewport even though the physical screenshot is390px wide.
  await browser.navigate('/?scene=forklift-training&qa-hud-mobile=1');
  stage('mobile loaded');
  await browser.until(() => browser.evaluate('!context.roomTransition&&!context.roomTransitionView.active&&context.editor.simulation?.running'), 'The mobile public forklift example did not settle.');
  await mount();
  stage('mobile mounted');
  await browser.call(()=>{context.editor.vehicleDriving.hud.scrollTop=0;});await settle();
  const mobile=await snapshot();checkLayout(mobile,true);assert.equal(mobile.viewport.width,390);await browser.screenshot('vehicle-hud-mobile');
  await mouseClick('.vehicle-driving-help summary');
  const mobileExpanded=await snapshot();checkLayout(mobileExpanded,true);await browser.screenshot('vehicle-hud-mobile-expanded');
  await browser.call(()=>{const hud=context.editor.vehicleDriving.hud;hud.scrollTop=hud.scrollHeight;});await settle();await browser.screenshot('vehicle-hud-mobile-secondary');stage('mobile and secondary labels passed');
  await browser.call(()=>context.editor.vehicleDriving.unmount(true));
  assert.equal(await browser.evaluate('context.editor.vehicleDriving.hud.hidden'),true);
  assert.equal(await browser.evaluate('context.renderer.getContext().getError()'),0);
  browser.report.hud={desktop,expanded,mobile,mobileExpanded,initial,after,nativeClicks:desktopClicks.concat(await browser.evaluate('__qaHUDClicks'))};
  assert(browser.report.hud.nativeClicks.length>=3&&browser.report.hud.nativeClicks.every(click=>click.trusted));
  assert.deepEqual(browser.report.exceptions,[]);assert.deepEqual(browser.report.consoleErrors,[]);assert.deepEqual(browser.report.apiFailures,[]);assert.deepEqual(browser.report.writes,[]);
}
async function run() {
  const index=process.argv.indexOf('--expected-bundle-sha256'),expected=index<0?null:process.argv[index+1];
  assert(expected&&/^[a-f0-9]{64}$/.test(expected),'Pass the reviewed --expected-bundle-sha256.');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'bundle.js'))).digest('hex'),expected);
  fs.mkdirSync(OUTPUT,{recursive:true});const fixture=await startTemporaryServer();
  try {await withBrowser(fixture.origin,async browser=>{try{await verifyHUD(browser);}catch(error){browser.report.originalFailure=error.stack||String(error);fs.writeFileSync(path.join(OUTPUT,'vehicle-control-hud-failure.json'),JSON.stringify(browser.report,null,2));throw error;}browser.report.bundleSha256=expected;fs.writeFileSync(path.join(OUTPUT,'vehicle-control-hud-browser.json'),JSON.stringify(browser.report,null,2));});assert.deepEqual(fixture.errors,[]);assert.deepEqual(fixture.writes,[]);}
  finally {await fixture.close();}
  console.log('Vehicle HUD: real public controls, grouped shortcuts, next action, native disclosure/power click, desktop/mobile layout and read-only guest access passed.');
}
module.exports={verifyHUD};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
