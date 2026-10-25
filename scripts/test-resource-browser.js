/* Exercise the real browser state machine and real procedural catalog factories.
 * DOM/render adapters avoid needing a GPU; no project database is opened.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const catalog = require('../shared/resourceCatalog');
const conveyorEquipment = require('../shared/conveyor-equipment');
const behaviorSchema = require('../shared/behaviors');
const studio = require('../shared/studio-document');
class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.listeners = {}; this.className = ''; this.scrollTop = 0; this.value = '';
    this.classList = {
      add: (...names) => { const list = new Set(this.className.split(/\s+/).filter(Boolean)); names.forEach(name => list.add(name)); this.className = Array.from(list).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => { const list = new Set(this.className.split(/\s+/).filter(Boolean)); const enable = force === undefined ? !list.has(name) : force; if (enable) list.add(name); else list.delete(name); this.className = Array.from(list).join(' '); return enable; }
    };
  }
  set textContent(text) { this.text = String(text); this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  appendChild(child) { if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child); child.parentNode = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, listener) { (this.listeners[name] || (this.listeners[name] = [])).push(listener); }
  dispatch(name, event = {}) { return Promise.all((this.listeners[name] || []).map(listener => listener(Object.assign({target: this, preventDefault() {}, stopPropagation() {}}, event)))); }
  querySelectorAll(selector) { const result = []; this.children.forEach(child => { if (selector.split(',').includes(child.tagName)) result.push(child); result.push(...child.querySelectorAll(selector)); }); return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.focused = true; }
}
const source = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialPrefabs.js'), 'utf8').replace(/^import .*$/gm, '').replace(/export (const|function) /g, '$1 ');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', source + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const browserSource = fs.readFileSync(path.join(__dirname, '../src/editor/ResourceBrowser.js'), 'utf8').replace(/^import .*$/gm, '').replace('export default class ResourceBrowser', 'class ResourceBrowser');
const saved = new Map();
const storage = {getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value)};
const ResourceBrowser = new Function('THREE', 'catalog', 'createIndustrialPrefab', 'document', 'window', browserSource + '\nreturn ResourceBrowser;')(THREE, catalog, createIndustrialPrefab, {createElement: tag => new Element(tag)}, {localStorage: storage});
function makeBrowser(overrides = {}) {
  const state = {changes: [], messages: [], placed: [], selected: [], previews: 0, cleaned: 0, thumbnailResets: 0, thumbnailLoads: [], resourceLoads: 0};
  const library = {
    instantiate() { state.resourceLoads++; return Promise.resolve(new THREE.Group()); },
    preview(entry, region) { state.previews++; region.appendChild(new Element('preview')); return Promise.resolve(() => state.cleaned++); },
    previewModel(object, region, disposers) { assert(object.isObject3D); state.previews++; disposers.push(() => state.cleaned++); },
    cancelPreview() {}
  };
  const thumbnails = {library, reset() { state.thumbnailResets++; }, attach(entry, region) { state.thumbnailLoads.push(entry); }};
  const options = Object.assign({host: new Element('section'), library, thumbnails,
    onPlace: resource => state.placed.push(resource), onSelect: resource => state.selected.push(resource),
    onChange: organization => { studio.normalize({version: 1, organization}); state.changes.push(organization); },
    onMessage: message => state.messages.push(message)
  }, overrides);
  const browser = new ResourceBrowser(options);
  browser.setActive(true);
  return {browser, state, options};
}
const imports = [{path: 'upload/carton.glb', name: 'carton.glb', importId: 'batch-1-carton', kind: 'model', extension: 'glb', size: 1024, url: '/api/assets/' + '1'.repeat(64)}, {path: 'notes.csv', name: 'notes.csv', importId: 'batch-1-data', kind: 'text', extension: 'csv', size: 55}];

async function run() {
  const ids = new Set();
  catalog.RESOURCES.forEach(resource => {
    assert(!ids.has(resource.id)); ids.add(resource.id);
    ['id', 'name', 'technicalName', 'category', 'description', 'thumbnail', 'model', 'dependencies', 'dimensions', 'components', 'parameters', 'ports', 'simulation', 'interaction', 'version', 'origin', 'license', 'status'].forEach(key => assert(Object.prototype.hasOwnProperty.call(resource, key), resource.id + ' lacks ' + key));
    if (resource.status === 'development') { assert.equal(resource.action, null); assert(resource.reason.length); }
    if (resource.action && resource.action.type === 'prefab') {
      const object = createIndustrialPrefab(resource.action.kind, resource.action.variant);
      assert(object.isObject3D && object.children.length, 'Functional prefab must have a real factory.');
      assert((object.userData.editorDefaultBehaviors || []).length, 'A functional machine must carry real behavior.');
    }
  });
  assert.equal(catalog.CONVEYOR_FAMILIES.length, 8, 'Eight family entries organize the technical variants.');
  assert.equal(catalog.RESOURCES.filter(resource => resource.subcategory === 'conveyors').length, conveyorEquipment.listEquipment({readyOnly: true}).length, 'Every available variant comes from the common definition, without placeholder equipment.');
  assert(catalog.RESOURCES.filter(resource => resource.subcategory === 'conveyors').every(resource => resource.action && resource.equipmentId && resource.definition === conveyorEquipment.getDefinition(resource.equipmentId)));
  assert.equal(catalog.RESOURCES.find(resource => resource.id === 'library:source.generator').category, 'simulationtools', 'Logical product generation is separate from physical feeding stations.');
  assert(catalog.matches(catalog.RESOURCES.find(resource => resource.id === 'library:conveyor.curve'), 'esquina rodillos'));
  assert(catalog.matches(catalog.RESOURCES.find(resource => resource.id === 'library:processor.process'), 'maquina'));
  assert(!catalog.matches(catalog.RESOURCES[0], 'robot montacargas'));

  const {browser, state, options} = makeBrowser();
  browser.setEntries(imports.concat([{path: 'native.glb', name: 'native.glb', kind: 'model', extension: 'glb', size: 15}]));
  browser.setProject({id: 'project-A', organization: {}, templates: [{id: 'template-one', name: 'Línea', objects: [{}, {}]}], scenes: [{id: 'hall', name: 'Sala principal'}], widgets: [{id: 'counter-one', name: 'Entradas', kind: 'counter', roomId: 'hall'}], missions: [{id: 'mission-one', name: 'Clasificar 20', roomId: 'hall'}]});
  assert.equal(browser.render(), true);
  assert(browser.grid.textContent.includes('Recto'));
  assert(!browser.grid.textContent.includes('carton.glb'), 'Project imports must not leak into included library.');
  assert.equal(state.resourceLoads, 0, 'Listing a library must not instantiate a model.');
  browser.state.folder = 'industrial/conveyors'; browser.refresh();
  assert.equal(browser.cards.size, new Set(catalog.RESOURCES.filter(resource => resource.subcategory === 'conveyors').map(resource => resource.family)).size, 'The conveyor root groups actual models by family.');
  catalog.CONVEYOR_FAMILIES.forEach(family => assert(browser.folderList.textContent.includes(family.name), 'Every family must be discoverable.'));
  browser.state.folder = 'industrial/conveyors/straight'; browser.refresh();
  assert.equal(browser.cards.size, conveyorEquipment.listEquipment({family: 'straight', readyOnly: true}).length, 'Opening a family reveals its real variants.');
  browser.state.folder = ''; browser.refresh();
  const thumbnailLibrary = options.thumbnails.library;
  const curve = browser.resources.find(resource => resource.id === 'library:conveyor.curve');
  const curveModel = await thumbnailLibrary.instantiate({path: browser._thumbnailKey(curve)});
  assert.equal(curveModel.userData.editorDefaultBehaviors.find(component => component.type === 'conveyor').layout, 'curveLeft');
  assert.equal(state.resourceLoads, 0, 'Synthetic thumbnails must not request nonexistent files.');
  await thumbnailLibrary.instantiate({path: 'native.glb'}); assert.equal(state.resourceLoads, 1, 'Normal file loads keep the existing pipeline.');

  browser.state.query = 'rodillos'; browser.state.folder = 'industrial/conveyors'; browser.state.view = 'list'; browser.state.scroll = 117; browser.render(); browser.grid.scrollTop = 117;
  browser.openTab('project'); assert(browser.grid.textContent.includes('carton.glb')); assert(!browser.grid.textContent.includes('native.glb'));
  assert(browser.grid.textContent.includes('Entradas') && browser.grid.textContent.includes('Clasificar 20'), 'Created interfaces and missions are real project resources.');
  browser.state.query = 'carton'; browser.state.folder = 'models'; browser.state.selected = 'asset:batch-1-carton'; browser.state.scroll = 59; browser.render(); browser.grid.scrollTop = 59;
  browser.openTab('library'); assert.equal(browser.search.value, 'rodillos'); assert.equal(browser.state.folder, 'industrial/conveyors'); assert.equal(browser.state.view, 'list'); assert.equal(browser.grid.scrollTop, 117);
  browser.openTab('project'); assert.equal(browser.search.value, 'carton'); assert.equal(browser.grid.scrollTop, 59); assert.equal(browser.state.selected, 'asset:batch-1-carton');
  await new Promise(resolve => setImmediate(resolve)); assert(state.previews > 0);

  await Promise.all([browser.toggleFavorite(curve.id), browser.toggleFavorite('asset:batch-1-carton')]);
  assert.deepEqual(browser.organization.favorites, [curve.id, 'asset:batch-1-carton']);
  assert.equal(imports.length, 2, 'Favorites never create asset copies.');
  browser.openTab('favorites'); assert(browser.grid.textContent.includes(curve.name)); assert(browser.grid.textContent.includes('carton.glb'));
  browser.state.folder = 'origin:project'; browser.refresh(); assert(!browser.grid.textContent.includes(curve.name));

  await browser._mutate(organization => organization.folders.push({id: 'folder-custom', name: 'Línea 1', parentId: ''}));
  assert.equal(state.changes[state.changes.length - 1].folders[0].parentId, null, 'Persisted root folders use the canonical nullable reference.');
  const carton = browser.resources.find(resource => resource.id === 'asset:batch-1-carton');
  assert(await browser.moveResource(carton, 'folder-custom'));
  const moved = browser.resources.find(resource => resource.id === carton.id);
  assert.equal(moved.folderId, 'folder-custom'); assert.equal(moved.asset.importId, 'batch-1-carton'); assert.equal(moved.asset.path, 'upload/carton.glb');
  await browser._mutate(organization => { organization.resources[0].name = 'Caja reutilizable'; });
  assert.equal(browser.resources.find(resource => resource.id === carton.id).name, 'Caja reutilizable'); assert.equal(imports[0].name, 'carton.glb', 'Logical rename does not rewrite the original or its references.');
  browser.select(curve); assert.equal(state.selected[state.selected.length - 1].id, curve.id);
  browser.place(curve); assert.equal(state.placed.length, 1);
  browser.place({status: 'development', action: null, reason: 'El mecanismo todavía no está implementado.'}); assert.equal(state.placed.length, 1); assert.match(state.messages[state.messages.length - 1], /mecanismo/i);
  assert(browser.dropEvent({dataTransfer: {getData: type => type === 'application/x-hello-studio-resource' ? curve.id : ''}, preventDefault() {}}));
  assert.equal(state.placed.length, 2); assert.equal(browser.dropEvent({dataTransfer: {getData: () => ''}}), false);

  let deleted = 0;
  browser.options.onUsage = () => [{id: 'instance-1', label: 'Transportador · entrada'}]; browser.options.onDeleteResource = () => deleted++;
  await browser._deleteDialog(carton); const deleteButton = browser.editDialog.querySelectorAll('button').find(element => element.textContent === 'Eliminar referencia'); assert(deleteButton.disabled); assert.equal(deleted, 0);
  browser.options.onUsage = undefined; await browser._deleteDialog(carton); assert.match(state.messages[state.messages.length - 1], /comprobar/);

  const before = state.cleaned; browser.setActive(false); assert(state.cleaned > before, 'Leaving the editor releases its selected resource preview.');
  const thumbnailLoads = state.thumbnailLoads.length; browser.refresh(); assert.equal(state.thumbnailLoads.length, thumbnailLoads, 'Hidden editor must not schedule thumbnail rendering.');
  browser.setProject({id: 'project-B'}); browser.render(); assert.equal(browser.state.query, '');
  browser.setProject({id: 'project-A'}); browser.render(); assert.equal(browser.tab, 'favorites'); assert.equal(browser.state.folder, 'origin:project');
  // Direct level navigation must reveal existing scenes despite remembered
  // asset filters, then open the selected scene rather than copy its contents.
  const levels = studio.ROOM_IDS.map((id, index) => ({id, name: index === 1 ? 'Nivel propio' : 'Nivel ' + (index + 1)}));
  browser.setProject({id: 'project-levels', scenes: levels, organization: {folders: [{id: 'folder-levels', name: 'Mi planta', parentId: null}], resources: [{id: 'scene:sound', folderId: 'folder-levels'}]}});
  browser.openTab('project'); Object.assign(browser.state, {query: 'missing.glb', folder: 'models', kind: 'model', status: 'visual'}); browser.render();
  assert.equal(browser.cards.size, 0);
  browser.showScenes();
  assert.equal(browser.tab, 'project'); assert.equal(browser.state.folder, ''); assert.equal(browser.state.kind, 'scene'); assert.equal(browser.state.query, '');
  assert.equal(browser.cards.size, 10, 'All existing levels remain discoverable even when a reference was moved to a user folder.');
  const sceneCard = browser.cards.get('scene:sound');
  await sceneCard.dispatch('dblclick');
  assert.deepEqual(state.placed[state.placed.length - 1].action, {type: 'scene', roomId: 'sound'});

  const sceneFiles = imports.concat([
    {path: 'inactive.glb', name: 'inactive.glb', importId: 'other-level-model', kind: 'model', extension: 'glb'},
    {path: 'paint.png', name: 'paint.png', importId: 'hall-paint', kind: 'image', extension: 'png'},
    {path: 'signal.ogg', name: 'signal.ogg', importId: 'hall-signal', kind: 'audio', extension: 'ogg'},
    {path: 'external/model.gltf', name: 'model.gltf', importId: 'hall-external', batchId: 'external-batch', kind: 'model', extension: 'gltf'},
    {path: 'external/texture.png', name: 'texture.png', importId: 'hall-external-texture', batchId: 'external-batch', kind: 'image', extension: 'png'},
    {path: 'external/unrelated.glb', name: 'unrelated.glb', importId: 'hall-unrelated-model', batchId: 'external-batch', kind: 'model', extension: 'glb'}
  ]);
  const sceneDocument = {rooms: {
    hall: {additions: [{id: 'placed-box', descriptor: {importId: 'batch-1-carton'}, behaviors: [{type: 'surfaceWear', layers: JSON.stringify([{asset: 'hall-paint'}])}], interaction: {type: 'sound', asset: 'hall-signal'}}], overrides: [{id: 'native:hall:root.2', visual: {importId: 'hall-external'}}]},
    sound: {additions: [{id: 'placed-other', descriptor: {importId: 'other-level-model'}}], overrides: []}
  }, studio: {widgets: [{id: 'hall-counter', name: 'Mi contador', roomId: 'hall', kind: 'counter'}, {id: 'sound-counter', name: 'Otro contador', roomId: 'sound', kind: 'counter'}], missions: [{id: 'hall-mission', name: 'Mi misión', roomId: 'hall'}, {id: 'sound-mission', name: 'Otra misión', roomId: 'sound'}]}};
  const scope = catalog.sceneResources.index(sceneDocument, 'hall', sceneFiles);
  const used = entry => catalog.sceneResources.includes(scope, catalog.assetResource(entry));
  assert(used(sceneFiles[0]) && used(sceneFiles[3]) && used(sceneFiles[4]), 'Placed model, wear JSON texture and interaction audio belong to the active scene.');
  assert(used(sceneFiles[5]) && used(sceneFiles[6]), 'An active external glTF retains its texture dependencies.');
  assert(!used(sceneFiles[1]) && !used(sceneFiles[2]) && !used(sceneFiles[7]), 'Unused imports, inactive-room models and unrelated batch models stay hidden.');
  let activeRoom = 'hall';
  const sceneBrowser = makeBrowser({onSceneContext: () => ({document: sceneDocument, roomId: activeRoom})});
  sceneBrowser.browser.setEntries(sceneFiles);
  sceneBrowser.browser.setProject({id: 'scene-resource-project', scenes: levels, widgets: sceneDocument.studio.widgets, missions: sceneDocument.studio.missions, templates: [{id: 'unused-template', name: 'Plantilla no colocada', objects: [{}]}]});
  sceneBrowser.browser.openTab('project');
  assert.equal(sceneBrowser.browser.state.scope, 'scene');
  assert(sceneBrowser.browser.cards.has('asset:batch-1-carton') && sceneBrowser.browser.cards.has('widget:hall-counter') && sceneBrowser.browser.cards.has('mission:hall-mission'));
  assert(!sceneBrowser.browser.cards.has('asset:other-level-model') && !sceneBrowser.browser.cards.has('widget:sound-counter') && !sceneBrowser.browser.cards.has('mission:sound-mission') && !sceneBrowser.browser.cards.has('template:unused-template'));
  assert.equal(sceneBrowser.browser.resources.filter(resource => resource.kind === 'scene' && sceneBrowser.browser.cards.has(resource.id)).length, 10, 'Every level remains navigable from scene-scoped project files.');
  assert(!sceneBrowser.state.thumbnailLoads.some(entry => entry.importId === 'other-level-model'), 'A hidden scene asset must not schedule thumbnail loading.');
  sceneBrowser.browser.select('asset:batch-1-carton');
  await new Promise(resolve => setImmediate(resolve));
  const cleanedBeforeSwitch = sceneBrowser.state.cleaned;
  activeRoom = 'sound'; sceneBrowser.browser.refresh();
  assert(sceneBrowser.browser.cards.has('asset:other-level-model') && !sceneBrowser.browser.cards.has('asset:batch-1-carton'));
  assert(sceneBrowser.browser.cards.has('widget:sound-counter') && !sceneBrowser.browser.cards.has('widget:hall-counter'));
  assert.equal(sceneBrowser.browser.state.selected, ''); assert(sceneBrowser.state.cleaned > cleanedBeforeSwitch, 'Changing levels releases the previous scene file preview.');
  sceneBrowser.browser.scopeFilter.value = 'project'; await sceneBrowser.browser.scopeFilter.dispatch('change');
  assert(sceneBrowser.browser.cards.has('asset:batch-1-data') && sceneBrowser.browser.cards.has('asset:batch-1-carton'), 'The full project scope keeps unused imports available for placement.');
  activeRoom = 'hall'; sceneBrowser.browser.refresh();
  assert.equal(sceneBrowser.browser.state.scope, 'scene', 'Opening another level restores the scene-only file view.');
  sceneBrowser.browser.openTab('library'); assert(sceneBrowser.browser.cards.has('library:conveyor.straight'), 'Scene scoping does not shrink the included library.');
  sceneBrowser.browser.showProjectFiles(); assert.equal(sceneBrowser.browser.tab, 'project'); assert.equal(sceneBrowser.browser.state.scope, 'project');
  sceneBrowser.browser.showScenes(); assert.equal(sceneBrowser.browser.cards.size, 10);
  sceneBrowser.browser.dispose();

  browser.dispose(); assert.equal(options.thumbnails.library, options.library);
  const normalized = catalog.normalizeOrganization({favorites: [curve.id, curve.id], folders: [{id: 'a', name: 'A', parentId: 'b'}, {id: 'b', name: 'B', parentId: 'a'}]});
  assert.equal(normalized.favorites.length, 1); assert.equal(catalog.folderContains('absent', 'a', normalized.folders), false, 'Malformed cyclic folder trees must terminate safely.');
  console.log('Resource browser: real prefab contracts, tabs, navigation, lazy thumbnails, preview cleanup, logical folders, favorites, placement and usage guards passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
