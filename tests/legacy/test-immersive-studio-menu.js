const __layout = require("../../tooling/layout.cjs");
'use strict';
// Native Three.js meshes and RayControl; only the headset/Canvas/network are
// adapted boundaries. No real account, project database or password is used.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-immersive-studio-menu.js"), '..', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export var rayMaterial;', 'var rayMaterial;');
const Events = new Function(read("packages/render-three/src/EventDispatcher.js").replace('export default class EventDispatcher', 'return class EventDispatcher'))();
const RayControl = new Function('THREE', 'EventDispatcher', read("packages/render-three/src/RayControl.js").replace('export default class RayControl', 'class RayControl') + '\nreturn RayControl;')(THREE, Events);
const progressSchema = require('../../modules/logistica-industrial/practices/schema/PracticeProgress.cjs');
const configurableRecipes = require('../../modules/logistica-industrial/practices/configurable/Recipes.cjs');
const drawPracticeLayout = new Function(read('modules/logistica-industrial/practices/ui/PracticeLayoutCanvas.js').replace('export function drawPracticeLayout', 'function drawPracticeLayout') + '\nreturn drawPracticeLayout;')();
const PracticeImmersivePages = new Function('progressSchema', 'recipes', 'drawPracticeLayout', read('modules/logistica-industrial/practices/ui/PracticeImmersivePages.js').replace('export default class PracticeImmersivePages', 'class PracticeImmersivePages') + '\nreturn PracticeImmersivePages;')(progressSchema, configurableRecipes, drawPracticeLayout);
const Menu = new Function('THREE', 'PracticeImmersivePages', read("apps/workspace/studio/ImmersiveStudioMenu.js").replace('export default class ImmersiveStudioMenu', 'class ImmersiveStudioMenu') + '\nreturn ImmersiveStudioMenu;')(THREE, PracticeImmersivePages);
const user = id => ({id, username: id, displayName: 'Usuario ' + id, permissions: {editor: true, manageUsers: id === 'admin'}, preferences: {handedness: 'right', locomotion: 'smooth'}});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1, .05, 50); camera.position.set(0, 1.65, 1); scene.add(camera);
  const canvases = [], images = [], document = {baseURI:'https://fixture.invalid/workspace/', createElement(tag) {
    if(tag==='img'){const image={onload:null,complete:true,naturalWidth:900,naturalHeight:600,removeAttribute(key){if(key==='src')this.src='';}};images.push(image);return image;}
    assert.equal(tag, 'canvas', 'XR menu creates only a bounded canvas and lazy source images, never desktop forms or overlays.');
    const canvas = {width: 0, height: 0, text: [], drawnText:[], operations:[]}, drawing = {fillRect(x, y, width, height) { if (!x && !y && width === canvas.width && height === canvas.height) {canvas.text = [];canvas.drawnText=[];} canvas.operations.push(['fillRect',x,y,width,height]); }, fillText(value,x,y) { canvas.text.push(String(value));canvas.drawnText.push({text:String(value),x,y}); }, strokeRect(...args) {canvas.operations.push(['strokeRect',...args]);},measureText(text){return{width:String(text).length*13};},save(){},restore(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},drawImage(image,...args){canvas.operations.push(['drawImage',image.src,...args]);}};
    canvas.getContext = () => drawing; canvases.push(canvas); return canvas;
  }};
  const model = new THREE.Group(), beam = new THREE.Mesh(new THREE.BoxBufferGeometry(.001, .001, 1), new THREE.MeshBasicMaterial()); beam.name = 'beam'; model.add(beam);
  const session = {visibilityState: 'visible'}, calls = [], writes = [], applications = [], xr = {isPresenting: false, getSession: () => session};
  const ctx = {scene, camera, cameraRig: scene, vrMode: true, document, renderer: {xr}, assets: {teleport_model: {scene: model}, beam_tex: new THREE.Texture()}, shaders: {basic_vert: '', beam_frag: ''}, handedness: 'right'};
  ctx.raycontrol = new RayControl(ctx, 'right');
  const controls = ['left', 'right'].map(handedness => {
    const controller = new THREE.Group(); scene.add(controller); const source = {handedness, gamepad: {mapping: 'xr-standard', buttons: Array.from({length: 6}, () => ({pressed: false, value: 0})), hapticActuators: [{pulse() { calls.push('pulse:' + handedness); return Promise.resolve(true); }}]}};
    const data = ctx.raycontrol.addController(controller, source); return {controller, source, data};
  });
  const publicScenes = [{id: 'public-a', name: 'L rectangular', roomId: 'hall'}, {id: 'public-b', name: 'Clasificación', roomId: 'sound'}];
  const project = {id: 'project-a', name: 'Proyecto de prueba', revision: 1, access: {canEdit: true}, document: {studio: {scenes: [{id: 'hall', name: 'Nivel A'}, {id: 'sound', name: 'Nivel B'}]}}};
  const editor = {ctx, dirty: false, hooks: {clearKeyboard() { calls.push('clearKeyboard'); }}, industrialAudio: {volume: .7, muted: false, setMuted(value) { this.muted = value; }, setVolume(value) { this.volume = value; }, activate: async () => true},
    async applyServerProject(value, settings) { applications.push({project: value, settings}); },
    projectClient: {async request(method, route) { calls.push(route); if (route === '/public/scenes') return {scenes: publicScenes}; if (route === '/library/scenes') return {scenes: Array.from({length: 12}, (_, i) => ({id: 'library-' + i, name: 'Ejemplo ' + i, collection: 'Catálogo', roomId: 'hall'}))}; if (route.startsWith('/public/scenes/') || route.startsWith('/library/scenes/')) return {project: {id: 'view-' + route, document: {}, access: {canEdit: false}}}; throw new Error('Unexpected route ' + route); }, async listProjects() { return [project]; }, async getProject() { return project; }}
  };
  const client = {user: null, async login(username, password) { writes.push({kind: 'login', username, password}); this.user = user(username); }, async register(username, password, displayName, code) { writes.push({kind: 'register', username, password, displayName, code}); this.user = user(username); }, async me() { return {user: this.user}; }, async updateProfile(value) { writes.push(value); }, async classroom() { return {groups: [{name: 'Grupo A', assignments: [{id: 'assignment-a', title: 'Práctica A', evaluation: {score: 90}}]}]}; }, async request() { return {users: [{id: 'a', displayName: 'Nombre', username: 'nombre', role: 'creator', quota: {projects: 1, usedBytes: 1024}}]}; }};
  const studio = {ctx, editor, client, education: {missions: () => [], getProgress: () => ({status: 'active'})}, beforeImmersiveMenuOpen() { calls.push('releaseHeld'); }, async authenticated(options) { calls.push({authenticated: options}); menu.identityChanged(); }, async logout() { client.user = null; menu.identityChanged(); }, applyPreferences(preferences) { Object.assign(ctx, {handedness: preferences.handedness, studioLocomotion: preferences.locomotion}); }};
  const menu = new Menu(studio); scene.updateMatrixWorld(true);
  return {ctx, scene, camera, controls, menu, client, studio, editor, calls, canvases, images, writes, applications, session, project};
}
function hit(menu, region, object = menu.panel) { return {object, distance: 1, uv: new THREE.Vector2((region.x + region.width / 2) / 1024, 1 - (region.y + region.height / 2) / 960)}; }
function press(f, key, index = 1) {
  f.menu.tick(.016); const region = f.menu.regions.find(value => value.key === key); assert(region, 'Missing interactive region ' + key); f.menu.press(hit(f.menu, region), f.controls[index].controller); f.menu.release(f.controls[index].controller); f.menu.tick(.016); return region;
}
function aim(f, controller, mesh, u = .5, v = .5) {
  mesh.updateWorldMatrix(true, false); const size = mesh.geometry.parameters, point = mesh.localToWorld(new THREE.Vector3((u - .5) * size.width, (v - .5) * size.height, 0));
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion())); controller.position.copy(point).addScaledVector(normal, .6);
  controller.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(controller.position, point, new THREE.Vector3(0, 1, 0))); f.scene.updateMatrixWorld(true);
}
function toggleMenu(f, index = 1) {
  const pad = f.controls[index].data.inputSource.gamepad;
  pad.mapping = 'xr-standard';
  pad.buttons[4] = {pressed: false, value: 0}; f.menu.tick(.016);
  pad.buttons[4] = {pressed: true, value: 1}; f.menu.tick(.016);
  pad.buttons[4] = {pressed: false, value: 0}; f.menu.tick(.016);
}
function rayPress(f,key,index=1){
  f.menu.tick(.016);const region=f.menu.regions.find(row=>row.key===key);assert(region,'Missing XR campaign region '+key);
  const target=f.controls[index];aim(f,target.controller,f.menu.panel,(region.x+region.width/2)/1024,1-(region.y+region.height/2)/960);
  f.ctx.raycontrol.execute(f.ctx,.016,7);assert(target.data.currentIntersection&&target.data.currentIntersection.state===f.menu.state,'Campaign action '+key+' uses the real native panel ray inside its texture.');
  f.ctx.raycontrol.onSelectStart({target:target.controller});f.ctx.raycontrol.onSelectEnd({target:target.controller});f.menu.tick(.016);
}
async function campaignPages(){
  const native=require('../support/load-practice-scenes.cjs')(),index=require('../../modules/logistica-industrial/practices/configurable/index.cjs'),recipes=configurableRecipes,f=harness(),fixture=native.fixture(),launches=[],completions=[],next=[];
  let controller;
  f.client.user=user('campaign-alice');let owner=f.client.user.id;
  const host=f.studio.practiceCampaign={progress:progressSchema.empty(owner),async index(){return index;},async refresh(){return this.progress;},availability:(id,mode,settings)=>recipes.availability(id,mode,settings),context:()=>controller,async launch(id,settings){
    launches.push({id,settings:JSON.parse(JSON.stringify(settings))});
    assert(recipes.availability(id,settings.mode,settings).ready,'This evaluated fixture launches only a validated native configuration.');
    const built=native.buildConfigurablePracticeScene(fixture.document,'hall',id,{...settings,scene:fixture.scene});fixture.runtime.start('hall');native.advance(fixture,.1);
    const editor={simulation:fixture.runtime,document:fixture.document,projectGeneration:1,currentProject:null,roomId:'hall',canEditDocument:()=>false};
    controller=new native.PracticeController(editor,built.manifest,{panel:false,campaign:{userId:owner,routeId:progressSchema.routeFor(id).id,progress:this.progress,attemptId:'xr-campaign-CEDI-01'},isCurrent:()=>f.client.user&&f.client.user.id===owner,onPassed:receipt=>{completions.push(receipt);return false;},onNext:id=>{next.push(id);return true;}});
    f.editor.practiceController=controller;
  }};
  try{
    f.menu.setVR(true);f.menu.open('scenes');await flush();f.menu.tick(.016);
    assert.equal(f.menu.items.length,2);assert.deepEqual(f.menu.items.map(row=>row.routeId),['cedi','smart-factory']);
    const panel=f.menu.panel,group=f.menu.group,rayState=f.menu.state;assert.equal(group.children.length,1);assert.equal(f.canvases.length,1);
    rayPress(f,'item:smart-factory',0);await flush();f.menu.tick(.016);assert.equal(f.menu.items.length,5);assert.equal(f.menu.items[0].key,'SF-01');
    const later=f.menu.items.find(row=>row.key==='SF-02');assert.match(later.detail,/SF-01/);assert(!progressSchema.access(host.progress,'SF-02').allowed);
    // Locked campaign items still open their configuration for isolated preview;
    // the evaluated campaign start must remain blocked, not silently unlock.
    rayPress(f,'item:SF-02');assert.equal(f.menu.page,'practiceSetup');assert(f.menu.regions.find(row=>row.key==='practice-start').disabled);rayPress(f,'practice-start');assert.equal(launches.length,0);
    rayPress(f,'practice-setting:executionMode');assert.equal(f.menu.practicePages.settings.executionMode,'isolated');assert(!f.menu.regions.find(row=>row.key==='practice-start').disabled);assert(f.menu.canvas.text.some(value=>value.includes('sin evaluaci\u00f3n')));
    f.menu.navigate('scenes');await flush();f.menu.tick(.016);rayPress(f,'item:cedi');await flush();f.menu.tick(.016);assert.equal(f.menu.items.length,5);assert.equal(f.menu.items[0].key,'CEDI-01');rayPress(f,'item:CEDI-01',0);assert.equal(f.menu.page,'practiceSetup');
    const pages=f.menu.practicePages;for(const key of ['mode','difficulty','caseId','executionMode','evaluation','device'])assert(f.menu.regions.find(row=>row.key==='practice-setting:'+key));
    rayPress(f,'practice-setting:difficulty',0);rayPress(f,'practice-setting:difficulty');assert.equal(pages.settings.difficulty,3);assert.equal(pages.settings.caseId,'A','D3 does not choose an incident case on behalf of the learner.');
    rayPress(f,'practice-setting:mode');assert.equal(pages.settings.mode,'semiautomatic');assert(f.menu.canvas.text.some(value=>value.includes('sin evaluaci\u00f3n')));rayPress(f,'practice-setting:mode',0);assert.equal(pages.settings.mode,'automatic');rayPress(f,'practice-setting:mode');assert.equal(pages.settings.mode,'manual');
    rayPress(f,'practice-setup-next');assert.equal(pages.setupPage,1);for(const key of ['text','voice','hints'])assert(f.menu.regions.find(row=>row.key==='practice-help:'+key));
    rayPress(f,'practice-help:voice');assert.equal(pages.settings.helps.voice,true);rayPress(f,'practice-help:voice');assert.equal(pages.settings.helps.voice,false);
    rayPress(f,'practice-setup-next',0);assert.equal(pages.setupPage,2);rayPress(f,'practice-layout:1');assert.equal(pages.settings.layout.overrides.length,1);assert(f.menu.canvas.text.some(value=>value.includes('sin evaluaci\u00f3n')));rayPress(f,'practice-layout-reset');assert.deepEqual(pages.settings.layout,{preset:'prepared',overrides:[]});
    rayPress(f,'practice-setup-next');assert.equal(pages.setupPage,3);const sourceRecord=recipes.entry('CEDI-01');for(const step of sourceRecord.steps)assert(f.menu.canvas.text.some(value=>value.includes(step.title)));
    rayPress(f,'practice-start');await flush();assert.equal(launches.length,1);assert.equal(launches[0].id,'CEDI-01');assert.deepEqual(launches[0].settings,recipes.normalizedOptions({mode:'manual',caseId:'A',difficulty:3,executionMode:'campaign',evaluation:'assessed',device:'vr'}));assert(!f.menu.opened);assert(controller);assert.equal(controller.snapshot().totalUnits,48);assert.equal(fixture.runtime.products.size,6);
    f.menu.open('practice');f.menu.tick(.016);assert.equal(f.menu.panel,panel);assert.equal(f.menu.state,rayState);assert.equal(f.menu.group,group);assert.equal(f.canvases.length,1);
    assert(f.menu.regions.find(row=>row.key==='practice-next').disabled);rayPress(f,'practice-next');assert.equal(next.length,0);
    rayPress(f,'practice-verify');assert.equal(controller.session.done.length,0,'A verify click cannot replace a source transaction or native pallet movement.');
    assert.deepEqual(pages.values,{});rayPress(f,'practice-workflow-field:orderId',0);assert.equal(pages.values.orderId,controller.manifest.receiving.orderId);rayPress(f,'practice-workflow-field:dockId');assert.equal(pages.values.dockId,'E02');
    rayPress(f,'practice-workflow-field:boxes');assert.equal(pages.editing.key,'boxes');rayPress(f,'practice-key:4',0);rayPress(f,'practice-key:7');rayPress(f,'practice-key-done');assert.equal(pages.values.boxes,'47');rayPress(f,'practice-workflow-submit');assert.equal(controller.session.done.length,0);assert.equal(controller.workflow.state.arrival,null,'Incorrect user-entered quantity does not register arrival.');
    rayPress(f,'practice-workflow-field:boxes');rayPress(f,'practice-key-delete');rayPress(f,'practice-key:8',0);rayPress(f,'practice-key-done');assert.equal(pages.values.boxes,'48');rayPress(f,'practice-workflow-submit');assert(controller.workflow.state.arrival);assert.equal(controller.session.done.length,0,'Recording the order and verifying its source step remain separate.');rayPress(f,'practice-verify',0);assert.equal(controller.session.done.length,1,controller.lastMessage);
    assert.deepEqual(pages.values,{},'New workflow actions do not inherit previous answers.');rayPress(f,'practice-workflow-field:secured');rayPress(f,'practice-workflow-submit');assert.equal(controller.workflow.state.secured,true);rayPress(f,'practice-verify');assert.equal(controller.session.done.length,1,'Securing the dock cannot claim all six pallets have been physically unloaded.');
    assert.equal(controller.snapshot().sourceUnits,48);assert.equal(controller.snapshot().receiverUnits,0);assert.equal(controller.snapshot().totalUnits,48);assert.equal(fixture.runtime.products.size,6);assert.equal(completions.length,0,'No synthetic completion or progress event is generated by configuration/forms alone.');
    assert(!controller.session.state().passed);assert(!controller.completionSaved);assert(f.menu.regions.find(row=>row.key==='practice-next').disabled);assert(!progressSchema.access(host.progress,'CEDI-02').allowed);
    rayPress(f,'practice-order');await flush();assert.equal(f.menu.page,'practiceGuide');assert(f.menu.canvas.text.includes(controller.manifest.receiving.orderId));assert(f.menu.canvas.text.some(value=>value.includes('48 cajas')));rayPress(f,'practice-view:guide');
    assert.equal(f.menu.regions.filter(row=>row.key.startsWith('practice-view:')).length,4);rayPress(f,'practice-view:layout');assert(f.menu.canvas.operations.some(row=>row[0]==='strokeRect'&&row[3]>500));assert(f.menu.canvas.text.some(text=>text.includes('posiciones reales')));
    rayPress(f,'practice-view:diagram',0);assert(f.images.length>=1);assert(f.images.some(image=>image.src.startsWith('https://fixture.invalid/workspace/modules/logistica-industrial/practices/configurable/assets/')));assert(f.menu.canvas.operations.some(row=>row[0]==='drawImage'));
    for(const row of [sourceRecord.diagrams.process,...Object.values(sourceRecord.diagrams.layouts)])pages.image(row);assert.equal(pages.images.size,2);assert(f.images.some(image=>image.src===''));assert.equal(pages.image({src:'modules/logistica-industrial/practices/configurable/assets/../escape.png'}),null);assert.equal(pages.image({src:'https://external.invalid/track.png'}),null);
    rayPress(f,'practice-view:documentation');const readPages=[],pageCount=Math.ceil(pages.documentLines.length/17);assert(pageCount>1);assert(f.menu.regions.find(row=>row.key==='practice-doc-prev').disabled);
    for(let page=0;page<pageCount;page++){const drawn=f.menu.canvas.drawnText.filter(row=>row.x===46&&row.y>=267&&row.y<=763).map(row=>row.text);assert.deepEqual(drawn,pages.documentLines.slice(page*17,(page+1)*17));readPages.push(...drawn);assert.equal(pages.documentPage,page);const nextPage=f.menu.regions.find(row=>row.key==='practice-doc-next');assert.equal(Boolean(nextPage.disabled),page===pageCount-1);if(page<pageCount-1)rayPress(f,'practice-doc-next',page%2);}
    const content=readPages.join(' ').replace(/\s+/g,' ');for(const text of [sourceRecord.objective,sourceRecord.fixtureText,sourceRecord.result,sourceRecord.casesText])assert(content.includes(text.replace(/\s+/g,' ')));assert(content.includes(sourceRecord.modes.manual.actorsText.replace(/\s+/g,' ')));assert(!content.includes('[object Object]'));assert.equal(group.children.length,1,'All guide, documentation and workflow pages reuse the same native panel.');
    const oldPages=pages,oldImages=[...pages.images.values()];f.client.user=user('campaign-bob');owner=f.client.user.id;host.progress=progressSchema.empty(owner);f.menu.identityChanged();f.menu.tick(.016);
    assert(oldPages.disposed);assert.equal(oldPages.images.size,0);assert(oldImages.every(image=>image.onload===null&&image.src===''));assert.notEqual(f.menu.practicePages,oldPages);assert.deepEqual(f.menu.practicePages.values,{});assert.equal(f.menu.practicePages.index,undefined);assert.equal(f.menu.panel,panel);assert.equal(group.children.length,1);
    f.menu.navigate('scenes');await flush();f.menu.tick(.016);rayPress(f,'item:cedi');await flush();f.menu.tick(.016);assert(!progressSchema.access(host.progress,'CEDI-02').allowed);assert.match(f.menu.items.find(row=>row.key==='CEDI-02').detail,/CEDI-01/);
    assert.equal(f.canvases.length,1);f.menu.dispose();assert.equal(f.ctx.raycontrol.states[f.menu.stateName],undefined);assert.equal(f.menu.group,null);
  }finally{if(!f.menu.disposed)f.menu.dispose();if(controller)controller.dispose();if(fixture.runtime.active)fixture.runtime.stop();native.releaseGeometry(fixture);}
}
async function run() {
  const f = harness(), {menu, controls, ctx} = f;
  assert.equal(f.canvases.length, 0); menu.setVR(true); menu.tick(.016);
  assert.equal(menu.opened, false); assert.equal(Boolean(ctx.studioMenuOpen), false); assert.equal(menu.group, undefined); assert.equal(f.canvases.length, 0, 'Entering VR creates no floating label, panel or GPU canvas.');
  f.camera.position.x += .2; menu.tick(.016); assert.equal(f.canvases.length, 0, 'Head movement does not create any menu UI.');
  toggleMenu(f, 0);
  assert.equal(menu.opened, true); assert.equal(ctx.studioMenuOpen, true); assert.equal(f.canvases.length, 1); assert.equal(menu.canvas.width, 1024); assert.equal(menu.canvas.height, 960);
  assert.equal(menu.group.children.length, 1, 'The panel is the only menu object; no launcher exists.');
  assert(menu.state.consumeSelect && menu.state.captureSelect && menu.state.xrMenu && menu.state.vrOnly); assert.equal(menu.state.controller, 'both');
  assert.equal(menu.panel.parent, menu.group); assert(menu.group.parent === f.scene); assert.equal(menu.panel.userData.editorId, undefined); assert.equal(menu.texture.generateMipmaps, false); assert.equal(menu.panel.material.depthTest, false);
  assert(Math.abs(menu.panel.position.y - (f.camera.position.y - .08)) < 1e-8);
  const stationary = menu.panel.position.clone(); f.camera.position.x += .2; menu.tick(.016); assert(menu.panel.position.equals(stationary), 'Open panel stays fixed in world space, without chasing the user\'s head.');
  press(f, 'account', 0); press(f, 'field:username', 1); press(f, 'key:1:0', 0); assert.equal(menu.fields.username, 'q');
  press(f, 'field:password', 0); press(f, 'key:1:0', 1); assert.equal(menu.fields.password, 'q'); assert(menu.canvas.text.includes('•'), 'The password field draws a mask; individual characters also occur on the keyboard.');
  press(f, 'key:shift'); press(f, 'key:1:1'); assert.equal(menu.fields.password, 'qW'); press(f, 'key:symbols'); press(f, 'key:0:0'); assert.equal(menu.fields.password, 'qW!');
  press(f, 'key:delete'); assert.equal(menu.fields.password, 'qW'); press(f, 'key:clear'); assert.equal(menu.fields.password, '');
  menu.fields.username = 'demo'; menu.fields.password = 'fixture-secret-123'; menu.dirty = true; menu.tick(.016);
  assert(!menu.canvas.text.some(value => value.includes('fixture-secret-123')));
  await menu.authenticate(); assert.equal(f.writes[0].username, 'demo'); assert.equal(f.writes[0].password, 'fixture-secret-123'); assert.equal(menu.fields.password, ''); assert.equal(menu.fields.code, ''); assert.equal(menu.page, 'home'); assert(f.calls.some(value => value && value.authenticated && value.authenticated.immersive));
  menu.tick(.016); assert(menu.regions.some(region => region.key === 'progress'), 'Authenticated users can open their progress from the VR home page.');
  menu.navigate('scenes'); await flush(); menu.tick(.016); assert.equal(menu.items.length, 14); assert.equal(menu.regions.filter(value => value.key.startsWith('item:')).length, 6); press(f, 'next'); assert.equal(menu.listPage, 1);
  menu.navigate('projects'); await flush(); menu.tick(.016); await menu.chooseItem(menu.items[0]); assert.equal(menu.page, 'projectScenes'); assert.equal(menu.items.length, 2); assert.equal(menu.privateProject.id, f.project.id);
  await menu.chooseItem(menu.items[1]); assert.equal(f.applications[0].settings.roomId, 'sound'); assert.equal(menu.opened, false); assert.equal(menu.privateProject, null);
  menu.open('settings'); menu.tick(.016); press(f, 'volume-down'); assert(Math.abs(f.editor.industrialAudio.volume - .6) < 1e-8); await menu.setPreferences({locomotion: 'teleport'}); assert.equal(ctx.studioLocomotion, 'teleport');
  let clarity='sharp';ctx.graphics={getXRClarity:()=>clarity,setXRClarity:value=>{clarity=value;}};const profileWrites=f.writes.length;menu.dirty=true;menu.tick(.016);press(f,'xr-clarity');assert.equal(clarity,'balanced');menu.tick(.016);press(f,'xr-clarity');assert.equal(clarity,'sharp');assert.equal(f.writes.length,profileWrites,'The in-headset clarity control stays a local device preference.');
  menu.open('account'); menu.fields.password = 'discard-me'; menu.close(); assert.equal(menu.fields.password, ''); assert(!menu.canvas.text.some(value => value.includes('discard-me')));
  menu.tick(.016); assert.equal(menu.group.visible, false); assert.equal(menu.panel.visible, false); assert(!ctx.raycontrol.currentStates.includes(menu.state), 'A closed menu has no active ray target.');
  toggleMenu(f, 1); assert(menu.opened, 'The right A button can reopen the menu without any floating launcher.');
  // Both controllers operate actual panel UVs through RayControl. An unrelated
  // machine closer to the controller is excluded by the modal owner gate.
  const blocker = new THREE.Mesh(new THREE.PlaneBufferGeometry(4, 4), new THREE.MeshBasicMaterial({side: THREE.DoubleSide})); f.scene.add(blocker); blocker.position.copy(menu.panel.position).add(new THREE.Vector3(0, 0, .25)); blocker.quaternion.copy(menu.panel.quaternion);
  let machinePresses = 0, nativePresses = 0; ctx.raycontrol.addState('test-machine', {controller: 'both', colliderMesh: blocker, onSelectStart: () => machinePresses++}, true);
  ctx.raycontrol.addState('test-native', {controller: 'both', raycaster: false, onSelectStart: () => nativePresses++}, true);
  for (const [i, target] of controls.entries()) {
    menu.navigate('controls'); menu.tick(.016); const region = menu.regions.find(value => value.key === 'recenter');
    aim(f, target.controller, menu.panel, (region.x + region.width / 2) / 1024, 1 - (region.y + region.height / 2) / 960); ctx.raycontrol.execute(ctx, .016, 2 + i);
    assert(target.data.currentIntersection && target.data.currentIntersection.state === menu.state, 'Real menu hit for ' + target.source.handedness);
    ctx.raycontrol.onSelectStart({target: target.controller}); ctx.raycontrol.onSelectEnd({target: target.controller});
  }
  assert.equal(machinePresses, 0); assert.equal(nativePresses, 0);
  // A held face button when connecting is seeded, never treated as a new tap.
  menu.close(); const replacement = {handedness: 'left', gamepad: {mapping: 'xr-standard', buttons: Array.from({length: 6}, (_, i) => ({pressed: i === 4, value: i === 4 ? 1 : 0}))}};
  controls[0].data.inputSource = replacement; menu.tick(.016); assert(!menu.opened); replacement.gamepad.buttons[4] = {pressed: false, value: 0}; menu.tick(.016); replacement.gamepad.buttons[4] = {pressed: true, value: 1}; menu.tick(.016); assert(menu.opened); menu.tick(.016); assert(menu.opened, 'Holding X does not repeat-toggle.');
  replacement.gamepad.buttons[4] = {pressed: false, value: 0}; menu.tick(.016); replacement.gamepad.buttons[4] = {pressed: true, value: 1}; menu.tick(.016); assert(!menu.opened);
  // Reserved menu buttons and arbitrary unmapped button arrays are not bound.
  controls[1].source.gamepad.buttons[5] = {pressed: true, value: 1}; menu.tick(.016); assert(!menu.opened);
  controls[1].source.gamepad.mapping = ''; controls[1].source.gamepad.buttons[4] = {pressed: true, value: 1}; menu.tick(.016); assert(!menu.opened);
  menu.open(); menu.fields.password = 'hidden-secret'; f.session.visibilityState = 'visible-blurred'; menu.tick(.016); assert(!menu.opened); assert.equal(menu.fields.password, ''); assert.equal(menu.group.visible, false); f.session.visibilityState = 'visible'; menu.tick(.016); assert(!menu.opened, 'Returning from a system overlay does not reopen the menu.');
  menu.open(); menu.fields.password = 'lost-controller'; ctx.raycontrol.dispatchEvent('controllerDisconnected', controls[0].data); assert.equal(menu.fields.password, '');
  // Stale catalogue responses cannot leak another account's projects.
  menu.open('home'); const pending = deferred(); f.editor.projectClient.listProjects = () => pending.promise; menu.navigate('projects'); f.client.user = user('other'); menu.identityChanged(); pending.resolve([{id: 'old-user-project', name: 'Old private data'}]); await flush(); assert.equal(menu.items.length, 0);
  let geometries = 0, materials = 0, textures = 0; [menu.surface].forEach(value => { value.mesh.geometry.addEventListener('dispose', () => geometries++); value.mesh.material.addEventListener('dispose', () => materials++); value.texture.addEventListener('dispose', () => textures++); });
  const stateName = menu.stateName; menu.setVR(false); assert.equal(ctx.raycontrol.states[stateName], undefined); assert.equal(ctx.studioMenuOpen, false); assert.equal(menu.group, null); assert.equal(geometries, 1); assert.equal(materials, 1); assert.equal(textures, 1); assert.equal(f.canvases[0].width, 1);
  menu.setVR(true); menu.tick(.016); assert(!menu.opened); assert.equal(f.canvases.length, 1); toggleMenu(f); assert(menu.opened); assert.equal(f.canvases.length, 2); menu.dispose(); assert.equal(menu.disposed, true); assert.equal(menu.group, null); assert(!ctx.raycontrol.hasEventListener('controllerDisconnected', menu.controllerDisconnected));
  const head = harness(); head.ctx.renderer.xr.isPresenting = true; const arrayCamera = new THREE.ArrayCamera(); arrayCamera.matrixWorld.makeTranslation(5, 2, -4); head.ctx.renderer.xr.getCamera = () => arrayCamera;
  head.menu.setVR(true); head.menu.tick(.016); toggleMenu(head); assert(Math.abs(head.menu.panel.position.x - 5) < 1e-8); assert(Math.abs(head.menu.panel.position.y - 1.92) < 1e-8, 'Reads r112 XR matrixWorld without recomposing its stale local pose.'); head.menu.dispose();
  const registration = harness(); registration.menu.setVR(true); registration.menu.tick(.016); registration.menu.open('register'); registration.menu.tick(.016);
  assert(registration.menu.regions.some(region => region.key === 'field:code'));
  Object.assign(registration.menu.fields, {username: 'nuevo', password: 'registration-fixture-123', code: 'INVITE-FIXTURE'});
  await registration.menu.authenticate(true); assert.equal(registration.writes[0].kind, 'register'); assert.equal(registration.writes[0].code, 'INVITE-FIXTURE'); assert.equal(registration.menu.fields.password, ''); assert.equal(registration.menu.fields.code, ''); registration.menu.dispose();
  const rejected = harness(); rejected.menu.setVR(true); rejected.menu.tick(.016); rejected.menu.open('account'); rejected.client.login = async () => { throw new Error('Usuario o contraseña incorrectos.'); };
  Object.assign(rejected.menu.fields, {username: 'incorrecto', password: 'rejected-fixture-secret'}); await rejected.menu.authenticate(); rejected.menu.tick(.016);
  assert.equal(rejected.menu.busy, false); assert(rejected.menu.error.includes('incorrectos')); assert.equal(rejected.menu.fields.password, ''); assert(!rejected.menu.canvas.text.some(text => text.includes('rejected-fixture-secret'))); rejected.menu.dispose();
  const occupiedHand = harness(); occupiedHand.menu.setVR(true); occupiedHand.menu.tick(.016); occupiedHand.menu.close(); occupiedHand.menu.tick(.016);
  occupiedHand.controls[0].data.enabled = false;
  occupiedHand.studio.beforeImmersiveMenuOpen = () => { occupiedHand.calls.push('releaseOccupiedHand'); occupiedHand.controls[0].data.enabled = true; };
  occupiedHand.controls[0].source.gamepad.buttons[4] = {pressed: true, value: 1}; occupiedHand.menu.tick(.016);
  assert(occupiedHand.menu.opened, 'A physical X/A press opens the menu even when a held native stick suspended its target ray.');
  assert.equal(occupiedHand.controls[0].data.enabled, true, 'The opening hook releases the held item and restores the hand ray.'); assert(occupiedHand.calls.includes('releaseOccupiedHand')); occupiedHand.menu.dispose();
  const shortcut = harness(); shortcut.menu.setVR(true); toggleMenu(shortcut); press(shortcut, 'account');
  assert.equal(shortcut.menu.keyboardField, 'username', 'Opening sign-in immediately exposes the VR keyboard.');
  shortcut.menu.fields.username = 'demo'; press(shortcut, 'key:done'); assert.equal(shortcut.menu.keyboardField, 'password');
  shortcut.menu.fields.password = 'shortcut-fixture'; press(shortcut, 'key:done'); await flush();
  assert.equal(shortcut.writes.length, 1); assert.equal(shortcut.client.user.id, 'demo'); assert.equal(shortcut.menu.fields.password, ''); shortcut.menu.dispose();
  const retry = harness(); retry.editor.staticPublic = true; retry.menu.setVR(true); toggleMenu(retry); press(retry, 'account');
  assert(!retry.menu.regions.some(region => region.key.startsWith('field:')));
  retry.studio.reconnectAccountService = async () => { retry.editor.staticPublic = false; };
  press(retry, 'reconnect-account'); await flush(); retry.menu.tick(.016);
  assert.equal(retry.menu.page, 'account'); assert.equal(retry.menu.keyboardField, 'username'); assert(retry.menu.regions.some(region => region.key === 'field:password')); assert.equal(retry.writes.length, 0); retry.menu.dispose();
  const late = harness(); late.editor.staticPublic = true; late.menu.setVR(true); toggleMenu(late); press(late, 'account');
  const probe = deferred(); late.studio.reconnectAccountService = () => probe.promise;
  press(late, 'reconnect-account'); late.menu.close(); probe.resolve(); await flush(); late.menu.tick(.016);
  assert.equal(late.menu.opened, false, 'A delayed server probe cannot reopen the menu after closing.'); assert.equal(late.menu.keyboardField, ''); late.menu.dispose();
  const delayedLogout = harness(); delayedLogout.client.user = user('demo'); delayedLogout.menu.setVR(true); toggleMenu(delayedLogout);
  const logoutReply = deferred(); delayedLogout.studio.logout = async () => { await logoutReply.promise; delayedLogout.client.user = null; delayedLogout.menu.identityChanged(); };
  press(delayedLogout, 'logout'); delayedLogout.menu.close(); logoutReply.resolve(); await flush(); delayedLogout.menu.tick(.016);
  assert.equal(delayedLogout.menu.opened, false, 'Finishing logout never reopens a menu the user closed.'); assert.equal(delayedLogout.menu.group.visible, false); delayedLogout.menu.dispose();
  await campaignPages();
  console.log('Immersive Studio menu: native bounded canvases, both real controller rays/UVs, modal machine isolation, masked XR keyboard, login, authorized paginated scenes/projects, face-button edges, r112 head pose, identity/visibility/disconnect cleanup, two five-practice account routes, all nine configurable selectors, real native receiving custody, no form-only completion, paginated source reading and bounded image disposal passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
