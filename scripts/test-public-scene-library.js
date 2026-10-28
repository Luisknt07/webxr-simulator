'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const catalog = new Function(read('src/editor/StudySceneCatalog.js').replace(/^export /gm, '') + '\nreturn {STUDY_SCENES,DIFFICULTY_LABELS,MODE_LABELS};')();
class Element {
  constructor(tag, document) { this.tag = tag; this.ownerDocument = document; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = new Map(); this.isConnected = true; this.hidden = false; }
  set textContent(value) { this.text = String(value); this.children.forEach(child => {child.isConnected = false; child.parentNode = null;}); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(' '); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, action) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(action); }
  removeEventListener(type, action) { this.listeners.get(type)?.delete(action); }
  async fire(type) { for (const action of this.listeners.get(type) || []) await action({target: this}); }
  set src(value) { this.attributes.src = value; this.ownerDocument.images.push(value); } get src() { return this.attributes.src || ''; }
  focus() { this.ownerDocument.activeElement = this; }
}
const document = {baseURI: 'https://example.test/webxr-simulator/', images: [], createElement(tag) { return new Element(tag, this); }};
const source = read('src/editor/PublicSceneLibrary.js');
assert(!/WebGLRenderer|studyPreviewObject|compileStudyProject|createIndustrialPrefab/.test(source), 'The visitor library never constructs scene meshes or renderers.');
const {Library, publicSceneEntry} = new Function('STUDY_SCENES','DIFFICULTY_LABELS','MODE_LABELS','document', source.replace('export function publicSceneEntry','function publicSceneEntry').replace('export default class PublicSceneLibrary','class PublicSceneLibrary') + '\nreturn {Library:PublicSceneLibrary,publicSceneEntry};')(catalog.STUDY_SCENES,catalog.DIFFICULTY_LABELS,catalog.MODE_LABELS,document);
const View = new Function('compileBlankProject','PublicSceneLibrary', read('src/editor/ProjectAccessView.js').replace('export default class ProjectAccessView','return class ProjectAccessView'))(async()=>{},Library);
const sample = [
  {id:'l-transfer',name:'Transferencia rectangular',roomId:'hall',collection:'Fundamentos',templateId:'lab-transfer-l',included:true},
  {id:'forklift-training',name:'Práctica de montacargas',roomId:'hall',collection:'Logística',templateId:'forklift-training',included:true},
  {id:'original-photogrammetry',name:'Fotogrametría',roomId:'photogrammetry',collection:'Experiencias originales',original:true,included:true}
];
const walk = root => [root].concat(root.children.flatMap(walk));
const visibleCards = library => library.cards.filter(value=>!value.card.hidden).map(value=>value.entry.id);
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(user = null, previewAllExamples = true) {
  const calls=[],applied=[],host=new Element('div',document),editor={staticPublic:false,active:false,currentProject:{publicSceneId:'l-transfer'},async leave(){this.active=false;},async applyServerProject(...args){applied.push(args);},projectClient:{async request(method,url){calls.push([method,url]); if(url==='/public/scenes')return {scenes:sample,previewAllExamples}; if(url==='/library/scenes')return {scenes:[{id:'account-lesson',name:'Cuenta',roomId:'sound',collection:'Mi cuenta'}]}; return {project:{id:url,access:{canEdit:false}}};}}};
  const view=new View(editor),studio={client:{user},busy:false,closed:0,messages:[],async guard(action){if(this.busy)return;this.busy=true;try{return await action();}catch(error){this.messages.push(error.message);}finally{this.busy=false;}},close(){this.closed++;view.disposeGallery();},open(page){this.page=page;view.disposeGallery();}};
  editor.ctx={studio};return {view,editor,studio,host,calls,applied};
}
async function run() {
  const h=harness(),lib=await h.view.gallery(h.host,h.studio);
  assert.deepEqual(h.calls,[['GET','/public/scenes']], 'Only metadata is fetched when opening.');
  assert.equal(lib.cards.length,3); assert.equal(lib.groups.length,3); assert.equal(document.activeElement,lib.search);
  assert(walk(h.host).every(node=>node.tag!=='canvas'), 'No live preview canvas is created.');
  assert(lib.images.every(image=>image.loading==='lazy'&&image.decoding==='async'&&image.src.startsWith('https://example.test/webxr-simulator/assets/scene-thumbnails/')));
  const firstImage=lib.images[0],fallback=firstImage.parentNode.children[0];await firstImage.fire('load');assert.equal(fallback.hidden,true);await firstImage.fire('error');assert.equal(fallback.hidden,false);assert.equal(firstImage.hidden,true);assert.equal(h.calls.length,1,'A missing thumbnail never falls back to constructing or downloading a scene.');
  const originalCards=lib.cards.map(value=>value.card),requests=document.images.length;
  lib.search.value='montacargas';await lib.search.fire('input');assert.deepEqual(visibleCards(lib),['forklift-training']);
  lib.search.value='fotogrametria';await lib.search.fire('input');assert.deepEqual(visibleCards(lib),['original-photogrammetry'], 'Search ignores accents.');
  lib.search.value='';await lib.search.fire('input');lib.modeSelect.value='manual';await lib.modeSelect.fire('change');assert.deepEqual(visibleCards(lib),['forklift-training']);
  lib.modeSelect.value='';await lib.modeSelect.fire('change');lib.difficultySelect.value='1';await lib.difficultySelect.fire('change');assert.deepEqual(visibleCards(lib),['l-transfer']);
  lib.difficultySelect.value='';await lib.difficultySelect.fire('change');lib.categorySelect.value='missing';await lib.categorySelect.fire('change');assert.equal(lib.empty.hidden,false);
  lib.categorySelect.value='';await lib.categorySelect.fire('change');assert.deepEqual(lib.cards.map(value=>value.card),originalCards);assert.equal(document.images.length,requests,'Filtering reuses cards and image requests, without recreating previews.');
  const labels=walk(h.host).filter(node=>node.tag==='button').map(node=>node.textContent);assert(labels.every(label=>!/Crear|Editar|Copiar|Proyecto/.test(label)));
  await lib.explore(lib.entries[0]);assert.equal(h.studio.closed,1);assert.equal(h.applied.length,0);assert.equal(h.calls.length,1,'Continuing the current scene does not reload it.');assert(lib.disposed);

  const pending=harness(),gallery=await pending.view.gallery(pending.host,pending.studio),wait=deferred();
  pending.view.publicProject=async id=>{pending.calls.push(['project',id]);return wait.promise;};
  const first=gallery.explore(gallery.entries[1]);await gallery.explore(gallery.entries[2]);assert.equal(pending.calls.filter(c=>c[0]==='project').length,1,'Duplicate explore actions cannot fetch two worlds.');
  assert(gallery.fields.every(field=>field.disabled));const nodes=walk(pending.host);pending.view.disposeGallery();
  assert(nodes.every(node=>Array.from(node.listeners.values()).every(set=>set.size===0)), 'Closing removes every library listener.');
  assert(nodes.filter(node=>node.tag==='img').every(image=>!image.src), 'Closing releases image references.');
  wait.resolve({project:{id:'late',access:{canEdit:false}}});await first;assert.equal(pending.applied.length,0,'A closed gallery cannot apply a late scene response.');

  const identity=harness(),identityLibrary=await identity.view.gallery(identity.host,identity.studio),other=deferred();identity.view.publicProject=()=>other.promise;
  const opening=identityLibrary.explore(identityLibrary.entries[1]);identity.view.identityGeneration++;other.resolve({project:{id:'stale'}});await opening;assert.equal(identity.applied.length,0,'A changed identity invalidates a pending public selection.');identity.view.disposeGallery();

  const transition=harness(),transitionLibrary=await transition.view.gallery(transition.host,transition.studio),applied=deferred(),begun=deferred();
  transition.editor.applyServerProject=async()=>{begun.resolve();return applied.promise;};const transitioning=transitionLibrary.explore(transitionLibrary.entries[1]);await begun.promise;
  transition.studio.open('settings');applied.resolve(true);await transitioning;assert.equal(transition.studio.closed,0,'Completing an old load never closes a newer menu.');assert.equal(transition.studio.page,'settings');

  const metadata=harness(),meta=deferred();metadata.view.publicCatalog=()=>meta.promise;const waiting=metadata.view.gallery(metadata.host,metadata.studio);metadata.view.disposeGallery();meta.resolve({scenes:sample});assert.equal(await waiting,undefined);assert.equal(metadata.host.children.length,0,'Closing during metadata loading does not recreate the library.');
  const restricted=harness(null,false),restrictedLibrary=await restricted.view.gallery(restricted.host,restricted.studio);assert.equal(restricted.calls.filter(c=>c[1].startsWith('/library')).length,0);assert(restrictedLibrary.options.requiresLogin);restricted.view.disposeGallery();
  const signed=harness({id:'u1'},false),signedLibrary=await signed.view.gallery(signed.host,signed.studio);assert(signed.calls.some(c=>c[1]==='/library/scenes'));await signedLibrary.explore(signedLibrary.entries.find(e=>e.id==='account-lesson'));assert.equal(signed.applied.length,1);assert.equal(signed.applied[0][1].accessGeneration,0);assert(signed.calls.some(c=>c[1]==='/library/scenes/account-lesson'));
  const failed=harness(),failureLibrary=await failed.view.gallery(failed.host,failed.studio);failed.view.publicProject=async()=>{throw Error('Network unavailable');};await failureLibrary.explore(failureLibrary.entries[1]);assert.match(failureLibrary.feedback.textContent,/Network unavailable/);assert(failureLibrary.fields.every(field=>!field.disabled));assert.equal(failed.applied.length,0);failed.view.disposeGallery();
  const unsafe=publicSceneEntry({id:'../../private',name:'<script>unsafe</script>',roomId:'hall'});assert.equal(unsafe.thumbnail,false);assert.equal(unsafe.title,'<script>unsafe</script>');
  console.log('Visitor scene library: categorized metadata-only cards, lazy static images, reusable filters, user-only actions, single selection, account scope, late-close cancellation, private-route isolation and complete listener/image cleanup passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
