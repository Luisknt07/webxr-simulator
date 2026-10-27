'use strict';
// Production inspector and resource-browser state machines; no database writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const schema = require('../shared/behaviors');
const loadPrefix = (name, boundary, exports) => { const file = path.join(__dirname, name), text = fs.readFileSync(file, 'utf8'); return new Function('require', '__dirname', text.slice(0, text.indexOf(boundary)) + '\nreturn {' + exports + '};')(createRequire(file), __dirname); };
const editorFixture = loadPrefix('test-editor-runtime.js', 'async function run()', 'harness,dom,Element,storage,remote');
const resources = loadPrefix('test-resource-browser.js', 'async function run()', 'makeBrowser,Element');
const all = node => [node].concat(Array.from(node.children || []).flatMap(all));
const heading = section => Array.from(section.children).find(child => child.tagName === 'H3');
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

async function resourceDocking() {
  const {browser, state} = resources.makeBrowser(); browser.render();
  const item = browser.resources.find(value => value.id === 'library:conveyor.straight'); browser.select(item); await tick();
  const preview = browser.preview, content = browser.previewContent, loaded = state.previews, cleaned = state.cleaned, token = browser.previewToken;
  const right = new resources.Element('aside'), second = new resources.Element('aside');
  browser.setPreviewHost(right); assert.equal(preview.parentNode, right); assert.equal(browser.previewContent, content); assert.equal(browser.previewToken, token); assert.equal(state.previews, loaded); assert.equal(state.cleaned, cleaned);
  browser.setPreviewHost(second); assert.equal(preview.parentNode, second); assert.equal(right.children.length, 0); assert.equal(state.previews, loaded, 'Moving the one preview never instantiates another GPU model.');
  browser.setPreviewVisible(false); assert.equal(browser.previewCleanup, null); assert.equal(browser.previewResource, null); assert.equal(state.cleaned, cleaned + 1, 'Hidden resource content releases its private renderer/media.');
  browser.refresh(); assert.equal(state.previews, loaded, 'Refreshing cards while Object is active does not reload a hidden model.');
  browser.setPreviewVisible(true); await tick(); assert.equal(state.previews, loaded + 1); assert.equal(browser.previewResource, item.id);
  const variant = browser.resources.find(value => value.subcategory === 'conveyors' && value.family === item.family && value.id !== item.id);
  browser.select(variant); await tick(); const variantLoads = state.previews; browser.refresh();
  assert.equal(browser.previewResource, variant.id, 'A chosen variant remains visible when the root grid presents one card per family.'); assert.equal(state.previews, variantLoads);
  const thumbLoads = state.thumbnailLoads.length; browser.setListingVisible(false); browser.refresh(); assert.equal(state.thumbnailLoads.length, thumbLoads, 'A hidden Library never schedules thumbnails.');
  const visiblePreview = state.previews; browser.setPreviewHost(right); assert.equal(state.previews, visiblePreview, 'The full-height resource sheet works independently of the hidden Library.');
  browser.setPreviewVisible(false); browser.state.query = 'no-resource-matches-this'; browser.refresh(); const filteredLoads = state.previews;
  browser.setPreviewVisible(true); await tick(); assert.equal(state.previews, filteredLoads, 'Reopening the resource tab must not bypass the active filters.');
  browser.dispose(); assert.equal(browser.preview.parentNode, browser.previewHome); assert.equal(browser.previewCleanup, null);

  let finish, cleanups = 0;
  const pending = resources.makeBrowser({onPreview: () => new Promise(resolve => { finish = resolve; })}); pending.browser.render(); pending.browser.select(item);
  pending.browser.setPreviewVisible(false); finish(() => cleanups++); await tick(); assert.equal(cleanups, 1, 'A preview that completes after being hidden is disposed exactly once.'); pending.browser.dispose(); assert.equal(cleanups, 1);
}

async function inspector() {
  editorFixture.storage.clear(); editorFixture.remote.projects.clear();
  const f = editorFixture.harness(); await f.editor.ready; const e = f.editor; e.enter();
  editorFixture.Element.prototype.focus = function () { editorFixture.dom.activeElement = this; };
  let visibility = [], moves = [];
  e.resourceBrowser.setPreviewHost = host => moves.push(host);
  e.resourceBrowser.setPreviewVisible = visible => visibility.push(visible);
  for (const type of ['conveyor', 'source', 'processor', 'palletQueue']) {
    const object = e.document.addPrefab('hall', type, type === 'conveyor' ? 'distributor' : undefined); e.select(object);
    assert.equal(e.inspectorTab, 'object'); assert.equal(e.inspectorContent.hidden, false); assert.equal(visibility.at(-1), false);
    const sections = Array.from(e.inspectorContent.children), main = sections.findIndex(section => heading(section)?.textContent === 'CONFIGURACIÓN DEL EQUIPO');
    assert.equal(main, 2, type + ': machine configuration follows the visible transform section.');
    assert.equal(heading(sections[1])?.textContent, 'TRANSFORMACIÓN');
    const configuration = sections[main], components = all(configuration).filter(node => node.getAttribute('data-component-type') === type); assert.equal(components.length, 1);
    assert(all(configuration).some(node => node.tagName === 'LEGEND' && /Dimensiones/.test(node.textContent)));
    assert(all(configuration).some(node => node.tagName === 'LEGEND' && node.textContent === 'Operación'));
    const machineFields = all(configuration).filter(node => node.getAttribute('data-behavior-field')).map(node => node.getAttribute('data-behavior-field'));
    assert(machineFields.includes('width')); assert(machineFields.includes('enabled'));
    const transform = sections[1];
    assert.equal(transform.tagName, 'SECTION'); assert(all(transform).filter(node => node.tagName === 'INPUT').length >= 9, 'Position, rotation and scale stay open before equipment settings.');
    if (type === 'conveyor') assert(machineFields.includes('routing') && all(configuration).some(node => (node.className || '').includes('ed-rule-builder')), 'Classification rules stay with the machine settings.');
    if (type === 'source') {
      assert(machineFields.includes('quality') && machineFields.includes('defectRate') && machineFields.includes('generationMode'));
      assert(sections.some(section => heading(section)?.textContent === 'PRODUCTOS / CATÁLOGO SOURCE'));
      assert(!machineFields.includes('palletType'), 'An individual product does not expose irrelevant pallet settings.');
      e.updateConveyor(object,{loadMode:'pallet',palletType:'industrial-1200x1000',palletMaterial:'plastic',palletPacking:'fit',palletLayers:5});e.select(object);
      const packing=all(e.inspectorContent).find(node=>node.tagName==='FIELDSET'&&all(node).some(child=>child.tagName==='LEGEND'&&child.textContent==='Estiba y apilado'));
      const packingFields=all(packing).map(node=>node.getAttribute('data-behavior-field')).filter(Boolean);assert(['palletType','palletMaterial','palletPacking','palletLayers'].every(key=>packingFields.includes(key)));assert(!packingFields.includes('palletColumns')&&!packingFields.includes('palletWidth'));
    }
    if (type === 'processor') assert(machineFields.includes('processTime') && machineFields.includes('setupTime') && machineFields.includes('requiresOperator'));
    if (type === 'palletQueue') {
      assert(machineFields.includes('capacity') && machineFields.includes('palletCapacity'));
      e.updateConveyor(object,{palletType:'euro-1200x800',layoutMode:'fit',layers:5,maxStackHeight:1.8,autoRelease:true,releasePolicy:'stockFull',autoReleasePressure:true});e.select(object);
      const group=title=>all(e.inspectorContent).find(node=>node.tagName==='FIELDSET'&&all(node).some(child=>child.tagName==='LEGEND'&&child.textContent===title));
      const packing=all(group('Estiba y apilado')).map(node=>node.getAttribute('data-behavior-field')).filter(Boolean),dispatch=all(group('Despacho de estibas')).map(node=>node.getAttribute('data-behavior-field')).filter(Boolean);
      assert(['palletType','palletMaterial','layoutMode','layers','maxStackHeight'].every(key=>packing.includes(key)));assert(!packing.includes('columns')&&!packing.includes('rows'));assert(['autoRelease','releasePolicy','releaseInterval','autoReleasePressure'].every(key=>dispatch.includes(key)));
      const layer=all(e.inspectorContent).find(node=>node.getAttribute('data-behavior-field')==='layers');assert.equal(Number(layer.max),5);
    }
    const before = await e.document.serialize(), undo = e.document.undoStack.length;
    e.showInspectorTab('resource'); assert.equal(e.inspectorContent.hidden, true); assert.equal(visibility.at(-1), true); assert(moves.at(-1));
    assert.equal(e.inspectorTabButtons.get('resource').getAttribute('aria-selected'), 'true');
    await e.inspectorTabButtons.get('resource').fire('keydown', {key: 'Home', preventDefault() {}});
    assert.equal(e.inspectorTab, 'object'); assert.equal(editorFixture.dom.activeElement, e.inspectorTabButtons.get('object'));
    assert.deepEqual(await e.document.serialize(), before); assert.equal(e.document.undoStack.length, undo, 'Tab/layout changes never mutate or save the project.');
  }
  e.projectSync.stop(); e.clearAssembly(true);
}

async function cargoPresets() {
  editorFixture.storage.clear(); editorFixture.remote.projects.clear();
  const f = editorFixture.harness(); await f.editor.ready; const e = f.editor; e.enter();
  const field = key => all(e.inspectorContent).find(node => node.getAttribute('data-behavior-field') === key);
  const change = async (key, value) => { const input = field(key); assert(input, key); input.value = value; await input.fire('change'); await tick(); };
  const pallet = e.document.addPrefab('hall', 'product', 'pallet-loaded'); e.select(pallet);
  await change('width', 1.3); let p = e.document.getBehaviors(pallet).find(value => value.type === 'product'); assert.equal(p.palletType, 'custom');
  await change('palletType', 'euro-1200x800'); p = e.document.getBehaviors(pallet).find(value => value.type === 'product'); assert.equal(p.width, 1.2); assert.equal(p.depth, .8); assert.equal(p.units, 24); assert.equal(p.mass, 145);
  const source = e.document.addPrefab('hall', 'source'); e.select(source);
  await change('productVariant', 'pallet-loaded'); let s = e.document.getBehaviors(source).find(value => value.type === 'source'); assert.equal(s.loadMode, 'individual'); assert.equal(s.units, 24); assert.equal(s.mass * s.units, 145);
  await change('productType', 'crate'); s = e.document.getBehaviors(source).find(value => value.type === 'source'); assert.equal(s.productVariant, ''); assert.equal(s.productType, 'crate');
  e.document.setBehaviors(source, e.document.getBehaviors(source).map(value => { if (value.type !== 'source') return value; const old = Object.assign({}, value); delete old.units; delete old.productVariant; return old; })); e.select(source);
  assert.equal(Number(field('units').value), 1); assert.equal(field('productVariant').value, '');
  assert.equal(Object.hasOwn(e.document.getBehaviors(source).find(value => value.type === 'source'), 'units'), false, 'Viewing legacy defaults must not mutate the source.');
  e.projectSync.stop(); e.clearAssembly(true);
}
async function run() { await resourceDocking(); await inspector(); await cargoPresets(); console.log('Inspector workspace: transforms, grouped settings, cargo presets/type changes, legacy defaults, physical pallet sizes, previews, GPU cleanup and keyboard tabs passed.'); }
run().catch(error => { console.error(error); process.exitCode = 1; });
