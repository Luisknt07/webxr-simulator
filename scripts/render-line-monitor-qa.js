'use strict';
// Optional visual QA: render the production Canvas renderer from real sampled
// simulation data, with an isolated headless Chrome profile and no project DB.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {spawn} = require('node:child_process'), {pathToFileURL} = require('node:url');
const THREE = require('three'), WebSocket = require('ws'), schema = require('../shared/behaviors');
const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'data/qa-studio');
const fixture = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const h = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('\nasync function run()')) + '\nreturn {fixture,buildIndustrialLabLines,releaseGeometry};')(require, __dirname);
const source = fs.readFileSync(path.join(root, 'src/editor/LineMonitorSystem.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class LineMonitorSystem', 'class LineMonitorSystem');
const System = new Function('THREE', 'behaviorSchema', source + '\nreturn LineMonitorSystem;')(THREE, schema);
const f = h.fixture(), cell = h.buildIndustrialLabLines(f.document, 'hall', {scene: f.scene, cellIds: ['sorting']}).cells[0];
f.runtime.start('hall');
const advance = seconds => { for (let t = 0; t < seconds - 1e-9; t += .1) { f.scene.updateMatrixWorld(true); f.runtime.execute(Math.min(.1, seconds - t)); } };
advance(10); f.runtime.command(cell.controller.userData.editorId, 'pause', undefined, 'line');
advance(4); f.runtime.command(cell.controller.userData.editorId, 'start', undefined, 'line');
advance(16); f.runtime.command(cell.controller.userData.editorId, 'powerOff', undefined, 'line');
advance(3); f.runtime.command(cell.controller.userData.editorId, 'powerOn', undefined, 'line');
f.runtime.command(cell.controller.userData.editorId, 'start', undefined, 'line'); advance(13);
const board = f.document.addPrimitive('hall', 'box');
const config = schema.normalizeBehaviors([{type: 'lineMonitor', targetId: cell.controller.userData.editorId, scope: 'line', title: '02 · CLASIFICACIÓN / SUPERVISIÓN'}])[0];
f.document.setBehaviors(board, [config]);
f.ctx.document = {createElement: () => ({width: 0, height: 0, getContext: () => ({})})};
const monitor = new System(f.ctx, f.document, f.runtime), entry = monitor.create(board, config); entry.editing = false; entry.page = 'analytics';
const model = monitor.layout(entry, 'hall'), offset = model.project(new THREE.Vector3());
entry.focused = true;
const focusedModel = monitor.layout(entry, 'hall'), focusedView = {scale: focusedModel.scale, offset: focusedModel.project(new THREE.Vector3())};
entry.focused = false;
const data = Object.assign({}, model, {records: model.records.map(record => {
  const names = []; record.object.traverse(node => { if (node.name && !node.userData.editorRuntimeHelper) names.push(node.name); });
  return {id: record.id, config: record.config, variables: record.variables, position: record.position,
    definition: record.config.type === 'conveyor' ? schema.conveyorEquipment.resolveVariant(record.config) : null,
    object: {name: record.object.name, userData: {editorPrefabVariant: record.object.userData.editorPrefabVariant}, names}};
}), project: undefined, offset});
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const three = fs.readFileSync(path.join(root, 'node_modules/three/build/three.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const html = '<!doctype html><meta charset="utf-8"><style>body{margin:18px;background:#08131c;color:#dcecf5;font:15px sans-serif}canvas{display:block;margin-top:12px;border:1px solid #527486}</style>' +
  '<div>Canvas de producción · datos reales de 46 s simulados, incluidos 4 s de pausa y 3 s sin alimentación</div><canvas id="screen" width="1024" height="576"></canvas><script>' + three + '</script><script>' + source +
  '\nconst behaviorSchema={conveyorEquipment:{resolveVariant:config=>{const record=model.records.find(record=>record.config===config);return record&&record.definition}}},model=' + json(data) + ';' +
  'const point=p=>new THREE.Vector3(p.x,p.y,p.z),points=a=>a.map(point);model.project=p=>({x:model.offset.x+p.x*model.scale,y:model.offset.y+p.z*model.scale});' +
  'model.records.forEach(r=>{r.position=point(r.position);const saved=r.object,o=new THREE.Group();o.name=saved.name;o.userData=saved.userData;saved.names.forEach(name=>{const n=new THREE.Group();n.name=name;n.add(new THREE.Group());o.add(n)});r.object=o});' +
  'model.paths.forEach(p=>{["points","left","right","contour"].forEach(k=>p[k]=points(p[k]));p.rollers=p.rollers.map(points);p.chains=p.chains.map(points)});' +
  '[model.pallets,model.products,model.decks,model.mechanisms].forEach(list=>list.forEach(p=>{p.contour=points(p.contour);if(p.point)p.point=point(p.point)}));' +
  'model.links.forEach(l=>{l.source=point(l.source);l.target=point(l.target)});const canvas=document.getElementById("screen"),monitor=new LineMonitorSystem({}, {}, {}),entry={drawing:canvas.getContext("2d"),canvas,config:' + json(config) +
  ',selectedId:' + json(entry.selectedId) + ',page:"diagram",detailPage:0,eventPage:0,analysisPage:0,equipmentPage:0,equipmentOffset:0,moduleOnly:false,regions:[],presses:new Map(),texture:{},notice:""};' +
  'const originalView={scale:model.scale,offset:model.offset},focusedView=' + json(focusedView) + ',defaultSelection=entry.selectedId;' +
  'window.monitorQA={model,entry,render(page,sub=0,mode=""){entry.page=page;entry.analysisPage=sub;entry.equipmentPage=sub;entry.equipmentOffset=0;' +
  'entry.selectedId=defaultSelection;entry.focused=mode==="focus";entry.selectedProductId=mode==="product"&&model.products.length?model.products[0].id:null;Object.assign(model,entry.focused?focusedView:originalView);' +
  'if(page==="equipment"&&sub===1){const loaded=model.analytics.machines.find(machine=>machine.contents.length);if(loaded)entry.selectedId=loaded.id}' +
  'monitor.draw(entry,model);return entry.regions.length}};window.monitorQA.render("diagram");</script>';
fs.mkdirSync(artifacts, {recursive: true}); const page = path.join(artifacts, 'line-monitor-detailed.html'); fs.writeFileSync(page, html);
console.log(JSON.stringify({modules: model.records.length, products: model.products.length, paths: model.paths.length, pallets: model.pallets.length, analytics: model.analytics.summary, samples: model.analytics.history.length}));
monitor.dispose(); h.releaseGeometry(f);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-monitor-qa-')); let browser, socket;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(action) { const start = Date.now(); while (Date.now() - start < 30000) { const value = await action(); if (value) return value; await delay(100); } throw new Error('Timed out rendering the monitor.'); }
async function run() {
  const executable = process.env.STUDIO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser = spawn(executable, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-gpu',
    '--window-size=1080,680', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + temporary, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
  const port = await until(() => { try { return Number(fs.readFileSync(path.join(temporary, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (_) { return null; } });
  const tabs = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json()); socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0; const requests = new Map();
  socket.on('message', text => { const message = JSON.parse(text); if (!message.id) return; const pending = requests.get(message.id); if (!pending) return; requests.delete(message.id); if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', {expression, returnByValue: true}); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception.description); return result.result.value; };
  await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', {width: 1080, height: 680, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: pathToFileURL(page).href}); await until(() => evaluate('Boolean(window.monitorQA)').catch(() => false));
  for (const [name, section, sub, mode] of [['diagram', 'diagram', 0], ['focus', 'diagram', 0, 'focus'], ['product', 'diagram', 0, 'product'], ['summary', 'analytics', 0], ['trends', 'analytics', 1], ['control', 'analytics', 2], ['equipment', 'equipment', 0], ['contents', 'equipment', 1], ['parts', 'equipment', 2], ['operation', 'equipment', 3]]) {
    await evaluate('window.monitorQA.render(' + JSON.stringify(section) + ',' + sub + ',' + JSON.stringify(mode || '') + ')');
    const shot = await send('Page.captureScreenshot', {format: 'png'}); fs.writeFileSync(path.join(artifacts, 'line-monitor-' + name + '.png'), Buffer.from(shot.data, 'base64'));
    console.log('Rendered monitor:', name);
  }
  await send('Browser.close').catch(() => {});
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close(); if (browser && browser.exitCode === null) browser.kill(); await delay(300);
  const resolved = path.resolve(temporary); if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('hello-monitor-qa-')) throw new Error('Unsafe QA cleanup path.');
  fs.rmSync(resolved, {recursive: true, force: true});
});
