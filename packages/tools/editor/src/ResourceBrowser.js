import * as THREE from 'three';
import catalog from '../../../../modules/logistica-industrial/contracts/resourceCatalog.js';
import {createIndustrialPrefab} from '../../../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js';
import {setEditorIcon} from './EditorIcons.js';

const MIME = 'application/x-hello-studio-resource';
const PRESET_MIME = 'application/x-smarttwin-resource-preset';
const TABS = [['library', 'Biblioteca'], ['project', 'Proyecto'], ['favorites', 'Favoritos']];
const STORAGE_KEY = 'hello-studio-resource-browser-v1:';
const taxonomy = catalog.libraryTaxonomy;
const ICONS = {model: '◇', image: '▧', audio: '♫', video: '▶', text: '{ }', source: '◉', template: '▣', scene: '▱'};
const TYPE_NAMES = {model: 'Modelo 3D', image: 'Imagen', audio: 'Audio', video: 'Vídeo', text: 'Datos', source: 'Blender', template: 'Plantilla', scene: 'Escenario', simulationtool: 'Herramienta de simulación'};
const DOMAINS=[['all','Todos'],['logistics','Logística'],['industrial','Industrial'],['shared','Compartidos']];
const DOMAIN_GROUPS={logistics:new Set(['VE','AL','MU','PI','EM']),industrial:new Set(['RO','EO','MA']),shared:new Set(['TR','UC','SE','SI','FLOW','COMMON','FILES'])};
const GROUP_ICONS={TR:'conveyor',VE:'vehicle',RO:'robot',AL:'rack',EO:'machine',MA:'machine',MU:'machine',PI:'person',EM:'product',UC:'product',SE:'safety',SI:'chip',FLOW:'chip',COMMON:'environment',FILES:'folder'};
function icon(element,name,label,compact=false){
  if(typeof setEditorIcon==='function')return setEditorIcon(element,name,label,compact);
  element.setAttribute('data-ed-icon',name);if(label!==undefined)element.textContent=label;
  if(compact){element.classList.add('ed-icon-only');element.setAttribute('aria-label',label||element.title||element.textContent);}return element;
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text, title, action, className = '') {
  const result = node('button', 'ed-button ' + className, text);
  result.type = 'button'; result.title = title; result.addEventListener('click', action);
  return result;
}
function tabState() { return {query: '', selected: '', folder: '', scroll: 0, navScroll: 0, navScrollX:0, expanded: {}, view: 'cards', kind: 'all', status: 'all', domain:'all', scope: 'scene'}; }
function allStates() { return {library: tabState(), project: tabState(), favorites: tabState()}; }
function size(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1048576).toFixed(1).replace(/\.0$/, '') + ' MiB';
}
function disposeObject(object) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  object.traverse(part => {
    if (part.geometry) geometries.add(part.geometry);
    (Array.isArray(part.material) ? part.material : [part.material]).filter(Boolean).forEach(material => {
      materials.add(material);
      Object.keys(material).forEach(key => { if (material[key] && material[key].isTexture) textures.add(material[key]); });
    });
  });
  textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose()); geometries.forEach(geometry => geometry.dispose());
}
function procedural(resource) {
  const action = resource && resource.action;
  if (!action) throw new Error('Este recurso todavía no se puede insertar.');
  if (action.type === 'prefab') return createIndustrialPrefab(action.kind, action.variant);
  if (action.type === 'studio' && action.method === 'addLineMonitor') {
    const group = new THREE.Group(), bezel = new THREE.Mesh(new THREE.BoxBufferGeometry(3, 1.75, .1), new THREE.MeshStandardMaterial({color: '#111e2a', roughness: .7})); group.add(bezel);
    const display = new THREE.Mesh(new THREE.PlaneBufferGeometry(2.8, 1.55), new THREE.MeshBasicMaterial({color: '#203a4c'})); display.position.z = .056; group.add(display);
    const frame = new THREE.Mesh(new THREE.BoxBufferGeometry(1.8, .2, .012), new THREE.MeshBasicMaterial({color: '#77e1ca'})); frame.position.set(-.2, .17, .07); group.add(frame);
    for (let index = 0; index < 5; index++) { const bar = new THREE.Mesh(new THREE.BoxBufferGeometry(.16, .12 + index * .06, .012), new THREE.MeshBasicMaterial({color: '#74a7c1'})); bar.position.set(.35 + index * .21, -.38 + index * .03, .07); group.add(bar); }
    return group;
  }
  if (action.type === 'primitive') {
    const geometry = action.kind === 'plane' ? new THREE.PlaneBufferGeometry(2, 2) : new THREE.BoxBufferGeometry(1, 1, 1);
    const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: '#6f929b', roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide}));
    if (action.kind === 'plane') object.rotation.x = -Math.PI / 2;
    return object;
  }
  throw new Error('La vista de este recurso se configura al colocarlo.');
}

/** Browser owns only references and presentation. The editor owns scene mutations,
 * persistence and compatibility checks. All callbacks can fail without deleting
 * a file or silently changing an existing instance.
 */
export default class ResourceBrowser {
  constructor(options) {
    this.options = options;
    this.host = options.host;
    this.library = options.library;
    this.thumbnails = options.thumbnails;
    this.grid = options.grid || node('div', 'ed-asset-grid');
    this.folderList = options.folderList || node('nav', 'ed-folder-list');
    this.preview = options.preview || node('aside', 'ed-preview');
    this.entries = options.entries || [];
    this.organization = catalog.normalizeOrganization();
    this.templates = []; this.scenes = []; this.widgets = []; this.missions = []; this.extraResources = [];
    this.projectId = ''; this.active = false; this.tab = 'library'; this.states = allStates();
    this.resources = []; this.cards = new Map(); this.previewToken = 0; this.renderSignature = ''; this.previewVisible = true; this.listingVisible = true; this.previewSelection = null;
    this.sceneScope = null; this.sceneRoomId = null;
    this.mutationQueue = Promise.resolve();
    this.familySelections = new Map(); this.configurationDrafts = new Map(); this.invalidConfigurations=new Set();this.previewRefresh = null;
    this._build(); this._loadState();
    if (this.thumbnails) {
      // Keep the existing bounded, lazy, shared renderer. Synthetic entries use
      // private procedural resources; normal assets keep their existing loader.
      const library = this.library;
      this.originalThumbnailLibrary = this.thumbnails.library;
      const adapter = Object.create(library);
      adapter.instantiate = (descriptor, settings) => {
        const resource = this.resources.find(item => this._thumbnailKey(item) === descriptor.path);
        if (resource && !this._moduleAvailable(resource)) return Promise.reject(new Error('El módulo del recurso ya no está disponible.'));
        return resource ? Promise.resolve(procedural(resource)) : library.instantiate(descriptor, settings);
      };
      this.thumbnails.library = adapter; this.thumbnails.rootElement = this.grid;
    }
    this.navigationWidth = 0; this.navigationDisposed = false;
    if (typeof ResizeObserver !== 'undefined') {
      this.navigationObserver = new ResizeObserver(() => this._syncNavigationLayout());
      this.navigationObserver.observe(this.host);
    }
  }

  _build() {
    this.host.textContent = '';
    this.host.classList.add('studio-resources');
    const header = node('div', 'studio-resource-header');
    const tabs = node('div', 'studio-resource-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Origen de recursos');
    this.tabButtons = new Map();
    TABS.forEach(([id, label]) => {
      const tab = button(label, 'Abrir ' + label, () => this.openTab(id), 'studio-resource-tab');
      icon(tab,{library:'library',project:'project',favorites:'favorite'}[id]);
      tab.setAttribute('role', 'tab'); tab.id = 'studio-resource-tab-' + id;
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = TABS.findIndex(item => item[0] === id);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        this.openTab(TABS[next][0]); this.tabButtons.get(TABS[next][0]).focus();
      });
      tabs.appendChild(tab); this.tabButtons.set(id, tab);
    });
    header.appendChild(tabs);
    const domainBar=node('nav','studio-resource-domains');domainBar.setAttribute('aria-label','Ámbito de los recursos');this.domainButtons=new Map();DOMAINS.forEach(([id,label])=>{const control=button(label,'Recursos para '+label.toLowerCase(),()=>{this.state.domain=id;this.state.folder='';this.state.scroll=0;this._stateChanged();},'studio-resource-domain');control.setAttribute('data-resource-domain',id);domainBar.appendChild(control);this.domainButtons.set(id,control);});header.appendChild(domainBar);
    this.scenesButton = button('Escenarios', 'Abrir el catálogo de escenarios completos y las escenas del proyecto', () => this._call('onScenes'), 'studio-resource-scenes');icon(this.scenesButton,'cube');
    header.appendChild(this.scenesButton);
    this.scopeFilter = node('select', 'studio-resource-scope'); this.scopeFilter.setAttribute('aria-label', 'Archivos de la escena o de todo el proyecto');
    [['scene', 'Escena actual'], ['project', 'Todo el proyecto']].forEach(([value, label]) => { const option = node('option', '', label); option.value = value; this.scopeFilter.appendChild(option); });
    this.scopeFilter.title = 'La escena actual muestra únicamente sus recursos en uso. Todo el proyecto permite elegir archivos sin colocar.';
    this.scopeFilter.addEventListener('change', () => { this.state.scope = this.scopeFilter.value; this.state.scroll = 0; this.clearPreview(); this._stateChanged(); }); header.appendChild(this.scopeFilter);
    this.search = node('input', 'studio-resource-search'); this.search.type = 'search'; this.search.placeholder = 'Buscar recursos…'; this.search.setAttribute('aria-label', 'Buscar por nombre, sinónimo o etiqueta');
    this.search.addEventListener('input', () => { this.state.query = this.search.value; this.state.scroll = 0; this._stateChanged(); }); header.appendChild(this.search);
    this.kindFilter = node('select'); this.kindFilter.setAttribute('aria-label', 'Filtrar recursos por tipo');
    [['all', 'Todos los tipos'], ['equipment', 'Equipos'], ['simulationtool', 'Simulación'], ['model', 'Modelos 3D'], ['image', 'Imágenes'], ['audio', 'Audio'], ['video', 'Vídeo'], ['source', 'Blender'], ['text', 'Datos'], ['template', 'Plantillas'], ['scene', 'Escenarios'], ['interface', 'Interfaces'], ['mission', 'Misiones']].forEach(([value, label]) => { const option = node('option', '', label); option.value = value; this.kindFilter.appendChild(option); });
    this.kindFilter.addEventListener('change', () => { this.state.kind = this.kindFilter.value; this.state.scroll = 0; this._stateChanged(); }); header.appendChild(this.kindFilter);
    this.statusFilter = node('select'); this.statusFilter.setAttribute('aria-label', 'Filtrar por estado funcional');
    [['all', 'Todos los estados']].concat(Object.entries(catalog.STATUS)).forEach(([value, label]) => { const option = node('option', '', label); option.value = value; this.statusFilter.appendChild(option); });
    this.statusFilter.addEventListener('change', () => { this.state.status = this.statusFilter.value; this.state.scroll = 0; this._stateChanged(); }); header.appendChild(this.statusFilter);
    this.cardView = button('Tarjetas', 'Vista de tarjetas', () => this._setView('cards'), 'studio-resource-view');icon(this.cardView,'grid','Tarjetas',true);
    this.listView = button('Lista', 'Vista de lista', () => this._setView('list'), 'studio-resource-view');icon(this.listView,'rows','Lista',true);header.appendChild(this.cardView); header.appendChild(this.listView);
    this.expandGroups = button('Expandir', 'Expandir todas las categorías de la biblioteca', () => this._expandLibrary(true), 'studio-resource-view');icon(this.expandGroups,'expand','Expandir',true);
    this.collapseGroups = button('Contraer', 'Contraer todas las categorías de la biblioteca', () => this._expandLibrary(false), 'studio-resource-view');icon(this.collapseGroups,'collapse','Contraer',true);
    header.appendChild(this.expandGroups); header.appendChild(this.collapseGroups);
    this.importButton = button('Importar', 'Importar archivos al proyecto conservando sus dependencias', () => { this.showProjectFiles(); this._call('onImport'); }, 'studio-resource-import');icon(this.importButton,'folder'); header.appendChild(this.importButton);
    const filterMenu=node('details','studio-resource-filter-menu');
    const filterToggle=node('summary','ed-button','Filtros y opciones');icon(filterToggle,'filter','Filtros y opciones',true);filterToggle.title='Filtros y opciones de la biblioteca';filterMenu.appendChild(filterToggle);
    const filterPanel=node('div','studio-resource-filter-panel');filterPanel.appendChild(node('strong','','Opciones de la biblioteca'));
    [this.statusFilter,this.scopeFilter,this.expandGroups,this.collapseGroups,this.importButton,this.scenesButton].forEach(control=>filterPanel.appendChild(control));filterMenu.appendChild(filterPanel);header.appendChild(filterMenu);
    this.host.appendChild(header);
    const body = node('div', 'ed-assets-body studio-resource-body');
    this.folderList.setAttribute('aria-label', 'Categorías y carpetas de recursos'); this.folderList.classList.add('studio-resource-folders');
    this.folderList.addEventListener('scroll', () => { this.state.navScroll = this.folderList.scrollTop;this.state.navScrollX=this.folderList.scrollLeft||0; this._saveState(); }, {passive: true});
    this.grid.setAttribute('role', 'tabpanel'); this.grid.classList.add('studio-resource-grid');
    this.grid.addEventListener('scroll', () => { this.state.scroll = this.grid.scrollTop; this._saveState(); }, {passive: true});
    this.preview.classList.add('studio-resource-preview'); this.preview.setAttribute('aria-label', 'Detalles y vista previa del recurso');
    this.subfamilyList=node('nav','studio-resource-subfamilies');this.subfamilyList.setAttribute('aria-label','Subfamilias de la categoría');
    body.appendChild(this.folderList);body.appendChild(this.subfamilyList);body.appendChild(this.grid); body.appendChild(this.preview); this.host.appendChild(body);
    this.previewHome = body;
    this.caption = node('div', 'studio-resource-caption'); this.caption.setAttribute('aria-live', 'polite'); this.host.appendChild(this.caption);
    this.editDialog = node('div', 'studio-resource-dialog'); this.editDialog.hidden = true; this.editDialog.setAttribute('role', 'dialog'); this.editDialog.setAttribute('aria-modal', 'true'); this.host.appendChild(this.editDialog);
    this.preview.appendChild(node('p', 'ed-hint', 'Selecciona un recurso para consultar sus propiedades. Arrástralo al escenario o usa Añadir.'));
  }

  get state() { return this.states[this.tab]; }
  /** Reparent the one existing preview, without cloning its renderer or media. */
  setPreviewHost(host) {
    const parent = host || this.previewHome;
    if (parent && this.preview.parentNode !== parent) parent.appendChild(this.preview);
    this.host.classList.toggle('studio-resource-docked', Boolean(host));
    this.preview.classList.toggle('studio-resource-preview-docked', Boolean(host));
  }
  setPreviewVisible(visible) {
    visible = Boolean(visible);
    if (visible === this.previewVisible) return;
    this.previewVisible = visible;
    if (!visible) this.clearPreview();
    else if (this.active) {
      const resource = this.previewSelection && this.previewSelection.id === this.state.selected ? this.previewSelection : null;
      if (resource) this._renderPreview(resource);
    }
  }
  setListingVisible(visible) {
    visible = Boolean(visible);
    if (visible === this.listingVisible) return;
    this.listingVisible = visible; this.renderSignature = '';
    if (!visible && this.thumbnails) this.thumbnails.reset();
  }
  setEntries(entries) { this.entries = Array.isArray(entries) ? entries : []; }
  setProject(project = {}) {
    const id = String(project.id || '');
    if (id !== this.projectId) {
      this._saveState(); this.projectId = id; this.states = allStates(); this.tab = 'library'; this._loadState();
      this.clearPreview(); this.previewSelection = null; this.renderSignature = '';
      this.familySelections.clear(); this.configurationDrafts.clear();this.invalidConfigurations.clear();
      this.sceneRoomId = null;
    }
    this.organization = catalog.normalizeOrganization(project.organization);
    this.templates = Array.isArray(project.templates) ? project.templates : [];
    this.scenes = Array.isArray(project.scenes) ? project.scenes : [];
    this.widgets = Array.isArray(project.widgets) ? project.widgets : [];
    this.missions = Array.isArray(project.missions) ? project.missions : [];
    this.extraResources = Array.isArray(project.resources) ? project.resources : [];
  }
  setActive(active) {
    active = Boolean(active);
    if (active === this.active) return;
    this.active = active; this.renderSignature = '';
    if (!active) { this.clearPreview(); if (this.thumbnails) this.thumbnails.reset(); }
  }
  openTab(tab) {
    if (!TABS.some(item => item[0] === tab)) return;
    this.state.scroll = this.grid.scrollTop; this.state.navScroll = this.folderList.scrollTop;this.state.navScrollX=this.folderList.scrollLeft||0; this.tab = tab; this.clearPreview(); this._stateChanged();
  }
  showScenes() {
    this.openTab('project');
    // Levels can have references in user folders. Filter by type across the
    // project so logical organization cannot hide a valid level here.
    Object.assign(this.state, {folder: '', kind: 'scene', status: 'all', query: '', scroll: 0});
    this._stateChanged();
  }
  showProjectFiles() {
    this.openTab('project');
    Object.assign(this.state, {scope: 'project', folder: '', kind: 'all', status: 'all', query: '', scroll: 0});
    this._stateChanged();
  }
  _setView(view) { this.state.scroll = this.grid.scrollTop; this.state.view = view; this._stateChanged(); }
  _stateChanged() { this.renderSignature = ''; this._saveState(); this.render(); }
  _loadState() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY + (this.projectId || 'unsaved')) || 'null');
      if (!stored || typeof stored !== 'object') return;
      if (TABS.some(item => item[0] === stored.tab)) this.tab = stored.tab;
      TABS.forEach(([tab]) => {
        const value = stored.states && stored.states[tab]; if (!value || typeof value !== 'object') return;
        const state = this.states[tab];
        ['query', 'selected', 'folder', 'kind', 'status'].forEach(key => { if (typeof value[key] === 'string') state[key] = value[key].slice(0, 1200); });
        state.view = value.view === 'list' ? 'list' : 'cards'; state.scroll = Number.isFinite(value.scroll) ? Math.max(0, value.scroll) : 0;
        state.scope = value.scope === 'project' ? 'project' : 'scene';
        state.domain=DOMAINS.some(row=>row[0]===value.domain)?value.domain:'all';
        state.navScroll = Number.isFinite(value.navScroll) ? Math.max(0, value.navScroll) : 0;
        state.navScrollX=Number.isFinite(value.navScrollX)?Math.max(0,value.navScrollX):0;
        if (value.expanded && typeof value.expanded === 'object') catalog.CATEGORIES.concat(taxonomy.GROUPS).forEach(category => { if (typeof value.expanded[category.id] === 'boolean') state.expanded[category.id] = value.expanded[category.id]; });
      });
    } catch (error) { /* Storage may be unavailable; navigation remains usable. */ }
  }
  _saveState() {
    try { window.localStorage.setItem(STORAGE_KEY + (this.projectId || 'unsaved'), JSON.stringify({tab: this.tab, states: this.states})); } catch (error) { /* Optional navigation preferences. */ }
  }
  _call(name, ...args) {
    if (typeof this.options[name] !== 'function') return undefined;
    try {
      const result = this.options[name](...args);
      if (result && typeof result.catch === 'function') result.catch(error => this._message(error.message || 'No se pudo completar la operación.'));
      return result;
    } catch (error) { this._message(error.message || 'No se pudo completar la operación.'); return undefined; }
  }
  _message(text) {
    if (this.options.onMessage) this.options.onMessage(text);
    else { this.caption.textContent = text; this.caption.classList.add('ed-error'); }
  }
  _buildResources() {
    const replacements = new Map(this.extraResources.map(resource => [resource.id, resource]));
    const builtins = catalog.RESOURCES.map(resource => replacements.get(resource.id) || resource);
    this.extraResources.forEach(resource => { if (!builtins.some(item => item.id === resource.id)) builtins.push(resource); });
    const native = taxonomy.decorate(builtins);
    // Documentation articles remain in the wiki. Only catalogue equipment and
    // actual project assets are resources; a missing model is never synthesized
    // into another equipment card from its theoretical illustration.
    this.resources = catalog.applyOrganization(native.concat(this.entries.map(catalog.assetResource), catalog.projectResources(this.templates, this.scenes, this.widgets, this.missions)), this.organization);
  }
  _moduleAvailable(resource) {try {return !resource.moduleId || !this.options.isModuleAvailable || this.options.isModuleAvailable(resource.moduleId) === true;} catch (_) {return false;}}
  _insertionPermitted() {try {return !!(this.active && (!this.options.canInsert || this.options.canInsert()));} catch (_) {return false;}}
  _canInsert(resource) {return !!(this._moduleAvailable(resource) && resource.action && resource.status !== 'development' && (resource.action.type === 'scene' || this._insertionPermitted()));}
  _expandLibrary(expand) {taxonomy.GROUPS.forEach(group => {this.states.library.expanded[group.id] = expand;}); this._stateChanged();}
  _family(resource) {return resource && resource.origin === 'library' && catalog.resourceFamilies ? catalog.resourceFamilies.familyFor(resource) : null;}
  _variants(resource) {const family=this._family(resource);return family ? catalog.resourceFamilies.listVariants(family.id,this.resources) : [];}
  _familyRows(resources) {
    if(this.tab!=='library'||!catalog.resourceFamilies)return resources;
    const defaults=new Map(catalog.resourceFamilies.listFamilies(resources).map(family=>[family.id,family.representativeId]));
    const groups=new Map(),rows=[];
    resources.forEach(resource=>{const family=this._family(resource);if(!family){rows.push(resource);return;}if(!groups.has(family.id)){groups.set(family.id,[]);rows.push(family.id);}groups.get(family.id).push(resource);});
    return rows.map(row=>{if(typeof row!=='string')return row;const variants=groups.get(row),selected=variants.find(resource=>resource.id===this.state.selected)||variants.find(resource=>resource.id===this.familySelections.get(row))||variants.find(resource=>resource.id===defaults.get(row));return selected||variants[0];});
  }
  _configuration(resource, submitted) {
    if(typeof this.options.getResourceConfiguration!=='function')return {fields:[],values:{}};
    const schema=this.options.getResourceConfiguration(resource)||{},fields=Array.isArray(schema.fields)?schema.fields:[],values={},draft=submitted===undefined?this.configurationDrafts.get(resource.id):submitted;
    if(fields.length>32)throw new Error('La configuración contiene demasiados parámetros.');
    const known=new Set();
    fields.forEach(field=>{
      if(!field||!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field.key)||['constructor','prototype','__proto__'].includes(field.key)||known.has(field.key)||!['number','select','checkbox'].includes(field.type))throw new Error('El parámetro de biblioteca no tiene un esquema válido.');
      known.add(field.key);let value=draft&&Object.prototype.hasOwnProperty.call(draft,field.key)?draft[field.key]:schema.values&&Object.prototype.hasOwnProperty.call(schema.values,field.key)?schema.values[field.key]:field.value;
      if(field.type==='number'){if(typeof value!=='number'||!Number.isFinite(value)||Number.isFinite(field.min)&&value<field.min||Number.isFinite(field.max)&&value>field.max)throw new Error('Revisa '+field.label+': el valor está fuera de los límites.');}
      else if(field.type==='checkbox'){if(typeof value!=='boolean')throw new Error('Revisa '+field.label+': selecciona una opción válida.');}
      else {const choices=Array.isArray(field.options)?field.options:[];if(!choices.some(option=>(typeof option==='object'?option.value:option)===value))throw new Error('Revisa '+field.label+': la variante no está disponible.');}
      values[field.key]=value;
    });
    if(submitted!==undefined&&(!submitted||typeof submitted!=='object'||Array.isArray(submitted)||Object.keys(submitted).some(key=>!known.has(key))))throw new Error('La configuración del recurso contiene parámetros desconocidos.');
    if(typeof this.options.normalizeResourceConfiguration==='function')this.options.normalizeResourceConfiguration(resource,Object.assign({},values));
    return {fields,values};
  }
  _preset(resource, parameters) {return {version:1,resourceId:resource.id,projectId:this.projectId,roomId:this.sceneRoomId,parameters:this._configuration(resource,parameters).values};}
  _writeDrag(event,resource) {
    if(!this._canInsert(resource)){event.preventDefault();this._message('El recurso requiere un módulo activo y permisos de edición.');return;}
    try {if(this.invalidConfigurations.has(resource.id))throw new Error('Corrige los parámetros antes de añadir este equipo.');const preset=this._preset(resource);event.dataTransfer.setData(MIME,resource.id);if(Object.keys(preset.parameters).length)event.dataTransfer.setData(PRESET_MIME,JSON.stringify(preset));if(resource.asset&&['model','image'].includes(resource.asset.kind))event.dataTransfer.setData('application/x-webxr-asset',resource.asset.importId||resource.asset.path);event.dataTransfer.effectAllowed='copyMove';}
    catch(error){event.preventDefault();this._message(error.message);}
  }
  _documentation(resource) {const link = resource.articleId || resource.documentationLinks && resource.documentationLinks[0] && resource.documentationLinks[0].articleId; if (link) return this._call('onDocumentation', {articleId: link, resourceId: resource.id});}
  _matchesDomain(resource){const domain=this.state.domain;if(!domain||domain==='all'||!DOMAIN_GROUPS[domain])return true;const group=taxonomy.location(resource).group;if(domain==='shared')return DOMAIN_GROUPS.shared.has(group);return DOMAIN_GROUPS[domain].has(group)||DOMAIN_GROUPS.shared.has(group);}
  render() {
    this._buildResources();
    const insertionAllowed = this._insertionPermitted(); if (insertionAllowed !== this.insertionAllowed) {this.insertionAllowed = insertionAllowed; this.clearPreview();}
    const context = typeof this.options.onSceneContext === 'function' ? this.options.onSceneContext() : null;
    if (context && context.roomId !== this.sceneRoomId) {
      this.sceneRoomId = context.roomId; this.states.project.scope = 'scene'; this.states.project.selected = ''; this.states.project.scroll = 0; this.clearPreview();
    }
    this.sceneScope = context ? catalog.sceneResources.index(context.document, context.roomId, this.entries) : null;
    const sceneIds = this.sceneScope && this.resources.filter(resource => resource.origin === 'project' && catalog.sceneResources.includes(this.sceneScope, resource)).map(resource => resource.id);
    const signature = JSON.stringify([this.active, this.listingVisible, this.tab, this.sceneRoomId, sceneIds, this.state.scope,this.state.domain, this.state.query, this.state.selected, this.state.folder, this.state.view, this.state.kind, this.state.status, this.organization, insertionAllowed, this.resources.map(resource => [resource.id, resource.name, resource.status, resource.description, resource.kind, resource.asset && resource.asset.url, this._moduleAvailable(resource)])]);
    if (signature === this.renderSignature) return true;
    this.renderSignature = signature;
    this.tabButtons.forEach((button, id) => { const selected = this.tab === id; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    this.grid.setAttribute('aria-labelledby', 'studio-resource-tab-' + this.tab);
    this.scopeFilter.hidden = this.tab !== 'project'; this.scopeFilter.value = this.state.scope;
    this.expandGroups.hidden = this.collapseGroups.hidden = this.tab !== 'library';
    this.search.value = this.state.query; this.kindFilter.value = this.state.kind; this.statusFilter.value = this.state.status;
    this.domainButtons.forEach((control,id)=>{control.setAttribute('aria-pressed',String(this.state.domain===id));control.classList.toggle('active',this.state.domain===id);});
    this.cardView.classList.toggle('active', this.state.view === 'cards'); this.listView.classList.toggle('active', this.state.view === 'list');
    this.cardView.setAttribute('aria-pressed', String(this.state.view === 'cards')); this.listView.setAttribute('aria-pressed', String(this.state.view === 'list'));
    this.grid.classList.toggle('studio-resource-grid--list', this.state.view === 'list');
    this._renderFolders();
    const folders = catalog.foldersFor(this.organization), favoriteIds = new Set(this.organization.favorites);
    let filtered = this.resources.filter(resource => {
      if (this.tab === 'library' && resource.origin !== 'library' || this.tab === 'project' && resource.origin !== 'project' || this.tab === 'favorites' && !favoriteIds.has(resource.id)) return false;
      if(!this._matchesDomain(resource))return false;
      if (this.tab === 'project' && this.state.scope === 'scene' && !catalog.sceneResources.includes(this.sceneScope, resource)) return false;
      if (this.state.kind !== 'all' && (this.state.kind === 'equipment' ? resource.kind !== 'equipment' && resource.category !== 'industrial' : resource.kind !== this.state.kind && (!resource.asset || resource.asset.kind !== this.state.kind))) return false;
      if (this.state.status !== 'all' && resource.status !== this.state.status) return false;
      if (this.state.folder) {
        if (this.tab === 'project') { if (!catalog.folderContains(this.state.folder, resource.folderId, folders)) return false; }
        else if (this.state.folder.startsWith('origin:')) { if (resource.origin !== this.state.folder.slice(7)) return false; }
        else if (this.state.folder.startsWith('group:')) {if (!taxonomy.matchesPath(resource, this.state.folder)) return false;}
        else { const [category, subcategory, family] = this.state.folder.split('/'); if (resource.category !== category || subcategory && resource.subcategory !== subcategory || family && resource.family !== family) return false; }
      }
      return catalog.matches(resource, this.state.query);
    });
    const eligibleSelection = filtered.find(resource => resource.id === this.state.selected && this._moduleAvailable(resource));
    if (!eligibleSelection && this.state.selected && this.resources.some(resource => resource.id === this.state.selected && !this._moduleAvailable(resource))) {this.state.selected = ''; this.clearPreview();}
    // Families are presentation only. Each card still selects, previews, drags
    // and inserts one exact native resource, including a variant found by search.
    const variantCount=filtered.length;
    filtered=this._familyRows(filtered);
    if (this.thumbnails) this.thumbnails.reset();
    this.grid.textContent = ''; this.cards.clear();
    if (this.tab === 'library') {
      const groups = new Map();
      filtered.forEach(resource => {const where = taxonomy.location(resource, this.state.folder), key = where.group + '/' + where.subgroup; if (!groups.has(key)) groups.set(key, {where, rows: []}); groups.get(key).rows.push(resource);});
      const order = group => taxonomy.GROUPS.findIndex(item => item.id === group.where.group);
      Array.from(groups.values()).sort((a, b) => order(a) - order(b)).forEach(group => {
        const heading = node('h3', 'studio-library-group-title', group.where.label + ' / ' + group.where.sublabel); heading.setAttribute('data-library-group', group.where.group + '/' + group.where.subgroup);
        heading.appendChild(node('span', 'studio-library-result-count', String(group.rows.length))); this.grid.appendChild(heading); group.rows.forEach(resource => this._renderCard(resource));
      });
    } else filtered.forEach(resource => this._renderCard(resource));
    if (!filtered.length) {
      const family = this.tab === 'library' && (catalog.CONVEYOR_FAMILIES || []).find(item => this.state.folder === 'industrial/conveyors/' + item.id);
      this.grid.appendChild(node('p', 'ed-hint studio-resource-empty', family ? family.name + ': todavía no hay variantes completas disponibles. Se habilitan cuando su modelo, mecanismo, conexiones y guardado están validados.' : this.tab === 'favorites' ? 'Marca un recurso con ☆ para conservar su referencia aquí. No se duplican sus archivos.' : this.tab === 'project' && this.state.scope === 'scene' && this.sceneScope ? 'Esta escena no utiliza archivos con estos filtros. Elige «Todo el proyecto» para añadir recursos guardados o importa un archivo.' : 'No hay recursos para estos filtros. Prueba otra categoría o importa archivos al Proyecto.'));
    }
    this.grid.scrollTop = this.state.scroll;
    this.caption.textContent = filtered.length + (this.tab==='library'?' familias y recursos · '+variantCount+' variantes':' recursos') + ' · ' + (this.tab === 'library' ? taxonomy.title(this.state.folder) || 'Toda la biblioteca · equipos y recursos registrados' : this.tab === 'project' ? this.state.scope === 'scene' && this.sceneScope ? 'Archivos usados en la escena actual · Escenarios muestra todos los niveles' : 'Todo el proyecto · incluye archivos todavía sin colocar' : 'Referencias a Biblioteca y Proyecto');
    const selected = eligibleSelection;
    this.previewSelection = selected || null;
    if (selected && this.active && this.previewVisible) {
      if (this.previewResource !== selected.id) this._renderPreview(selected);
    } else if (!selected) { this.clearPreview(); this.preview.textContent = ''; this.preview.appendChild(node('p', 'ed-hint', 'Selecciona un recurso para ver sus detalles y opciones.')); }
    return true;
  }
  refresh() { this.renderSignature = ''; return this.render(); }
  _syncNavigationLayout(force = false) {
    if (this.navigationDisposed || !this.active || !this.listingVisible || this.tab !== 'library') return;
    const width = Math.round(Number(this.host.clientWidth || (this.host.getBoundingClientRect && this.host.getBoundingClientRect().width) || 0));
    if (!width || !force && width === this.navigationWidth) return;
    this.navigationWidth = width;
    // A vertical scroll offset from the wide tree has no meaning in the compact
    // horizontal category rail. Keep both real selected controls visible when
    // the user changes panel width; never reorder or replace catalogue items.
    if (width <= 430) this.folderList.scrollTop = 0;
    const category = this.folderList.querySelector('.studio-library-category.is-selected > summary');
    const selected = (width <= 430 ? this.subfamilyList : this.folderList).querySelector('.studio-resource-folder.active');
    [category, selected].forEach(control => {if (control && control.scrollIntoView) control.scrollIntoView({block:'nearest', inline:'nearest'});});
  }
  _renderFolders() {
    this.folderList.textContent = '';this.subfamilyList.textContent='';this.subfamilyList.hidden=this.tab!=='library';
    const addFolder = (parent, id, label, count) => {
      const row = button(label, 'Ver ' + label, () => { this.state.folder = id; this.state.scroll = 0; this._stateChanged(); }, 'studio-resource-folder' + (this.state.folder === id ? ' active' : ''));
      row.setAttribute('aria-pressed', String(this.state.folder === id));
      if (count !== undefined) row.appendChild(node('span', 'studio-resource-folder-count', String(count)));
      if (this.tab === 'project') {
        row.addEventListener('dragover', event => { if (event.dataTransfer.types && Array.from(event.dataTransfer.types).includes(MIME)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
        row.addEventListener('drop', event => { const id = event.dataTransfer.getData(MIME); const resource = this.resources.find(item => item.id === id); if (!resource || resource.origin !== 'project') return; event.preventDefault(); event.stopPropagation(); this.moveResource(resource, row.dataset.folderId); });
        row.dataset.folderId = id;
      }
      parent.appendChild(row); return row;
    };
    const all=addFolder(this.folderList, '', this.tab === 'favorites' ? 'Todos los favoritos' : this.tab === 'project' ? this.state.scope === 'scene' && this.sceneScope ? 'Recursos de esta escena' : 'Todo el proyecto' : 'Toda la biblioteca');icon(all,'library');
    if (this.tab === 'library') {
      const included = this.resources.filter(resource => resource.origin === 'library'&&this._matchesDomain(resource));
      taxonomy.GROUPS.forEach(category => {
        const path = 'group:' + category.id, rows = included.filter(resource => taxonomy.matchesPath(resource, path));
        if(!rows.length)return;
        const group = node('details', 'studio-resource-category studio-library-category'); group.dataset.category = category.id;
        group.open = Object.prototype.hasOwnProperty.call(this.state.expanded, category.id) ? this.state.expanded[category.id] : category.id === 'TR' || this.state.folder.startsWith(path);
        group.addEventListener('toggle', () => {this.states.library.expanded[category.id] = group.open; this._saveState();});
        const title = node('summary');title.appendChild(node('span','studio-library-category-label',category.name));icon(title,GROUP_ICONS[category.id]||'cube');title.setAttribute('data-library-category',category.id);title.appendChild(node('span', 'studio-resource-folder-count', String(rows.length))); group.appendChild(title);
        if(this.state.folder===path||this.state.folder.startsWith(path+'/'))group.classList.add('is-selected');
        title.addEventListener('click',event=>{event.preventDefault();if(this.state.folder===path){group.open=!group.open;this.states.library.expanded[category.id]=group.open;this._saveState();}else{this.state.folder=path;this.state.scroll=0;this.states.library.expanded[category.id]=true;this._stateChanged();}});
        addFolder(group, path, 'Todos en esta categoría', rows.length);
        category.children.forEach(([id, name]) => {const family = category.id === 'TR' && (catalog.CONVEYOR_FAMILIES || []).find(family => family.id === id); const subpath = path + '/' + id, count = rows.filter(resource => taxonomy.matchesPath(resource, subpath)).length; if (count) {const row = addFolder(group, subpath, family && family.name || name, count); row.classList.add('studio-library-subcategory');}});
        this.folderList.appendChild(group);
      });
      const selectedCategory=taxonomy.GROUPS.find(category=>this.state.folder==='group:'+category.id||this.state.folder.startsWith('group:'+category.id+'/'))||taxonomy.GROUPS.find(category=>included.some(resource=>taxonomy.matchesPath(resource,'group:'+category.id)));
      if(selectedCategory){
        this.subfamilyList.appendChild(node('strong','studio-resource-subfamily-title','Subfamilias'));
        const parent='group:'+selectedCategory.id,rows=included.filter(resource=>taxonomy.matchesPath(resource,parent));
        addFolder(this.subfamilyList,parent,'Todas',rows.length);
        selectedCategory.children.forEach(([id,name])=>{const family=selectedCategory.id==='TR'&&(catalog.CONVEYOR_FAMILIES||[]).find(row=>row.id===id),path=parent+'/'+id,count=rows.filter(resource=>taxonomy.matchesPath(resource,path)).length;if(count)addFolder(this.subfamilyList,path,family&&family.name||name,count);});
      }
    } else if (this.tab === 'favorites') {
      addFolder(this.folderList, 'origin:library', 'De Biblioteca'); addFolder(this.folderList, 'origin:project', 'De Proyecto');
    } else {
      const folders = catalog.foldersFor(this.organization);
      const visited = new Set();
      const append = (parent, parentId, depth) => {
        folders.filter(folder => folder.parentId === parentId).forEach(folder => {
          if (visited.has(folder.id) || depth > 12) return;
          visited.add(folder.id);
          const row = addFolder(parent, folder.id, folder.name, this.resources.filter(resource => resource.origin === 'project' && (this.state.scope !== 'scene' || catalog.sceneResources.includes(this.sceneScope, resource)) && catalog.folderContains(folder.id, resource.folderId, folders)).length);
          row.style.paddingLeft = (12 + depth * 12) + 'px';
          row.addEventListener('contextmenu', event => { event.preventDefault(); this._editFolder(folder); });
          append(parent, folder.id, depth + 1);
        });
      };
      append(this.folderList, '', 0);
      this.folderList.appendChild(button('+ Carpeta', 'Crear una carpeta lógica; no mueve archivos en disco', () => this._editFolder(null)));
      if (this.state.folder) this.folderList.appendChild(button('Renombrar carpeta', 'Cambiar el nombre de la carpeta seleccionada', () => this._editFolder(folders.find(folder => folder.id === this.state.folder))));
      if (this.options.onCaptureTemplate) this.folderList.appendChild(button('▣ Guardar selección', 'Guardar la selección como plantilla reutilizable', () => this._call('onCaptureTemplate')));
    }
    this.folderList.scrollTop = this.state.navScroll;
    this.folderList.scrollLeft=this.state.navScrollX||0;
    this._syncNavigationLayout(true);
  }
  _renderCard(resource) {
    const selected = resource.id === this.state.selected;
    const family=this.tab==='library'&&this._family(resource),variants=family&&this._variants(resource);
    const card = node('div', 'ed-asset-card studio-resource-card' + (selected ? ' selected' : ''));
    card.setAttribute('data-resource-id',resource.id);
    if(family){card.classList.add('studio-resource-family-card');card.setAttribute('data-resource-family',family.id);}
    const choose = button('', resource.description, () => this.select(resource), 'studio-resource-choose'); choose.setAttribute('aria-label', 'Previsualizar ' + resource.name); choose.setAttribute('aria-pressed', String(selected));
    const thumbnail = node('span', 'ed-file-thumbnail studio-resource-thumbnail');
    const copy=node('span','studio-resource-card-copy');choose.appendChild(thumbnail);choose.appendChild(copy);copy.appendChild(node('strong','ed-file-name',family?family.name:resource.name));
    const detail = family ? variants.length+' variantes · '+resource.name : resource.asset ? TYPE_NAMES[resource.asset.kind] || 'Archivo' : resource.kind === 'equipment' ? 'Equipo configurable' : TYPE_NAMES[resource.kind] || 'Recurso';
    copy.appendChild(node('span', 'studio-resource-type', detail + (resource.asset ? ' · ' + size(resource.asset.size) : '')));
    const badge = node('span', 'studio-resource-status studio-resource-status--' + resource.status, catalog.STATUS[resource.status] || resource.status); copy.appendChild(badge);
    if (resource.articleId) copy.appendChild(node('span', 'studio-library-concept-label', resource.articleId + ' · Ficha conceptual · modelo pendiente'));
    if (!this._moduleAvailable(resource)) {card.classList.add('studio-library-module-disabled'); copy.appendChild(node('span', 'studio-library-module-label', 'Módulo no disponible en esta vista'));}
    const description = node('span', 'studio-resource-description', resource.description); copy.appendChild(description);
    if (resource.action && resource.status !== 'development') {
      choose.draggable = this._canInsert(resource) && resource.action.type !== 'workspace';
      choose.addEventListener('dragstart', event => this._writeDrag(event,resource));
      choose.addEventListener('dblclick', () => this.place(resource));
    }
    card.appendChild(choose);
    const favorite = this.organization.favorites.includes(resource.id);
    const star = button('Favorito', favorite ? 'Quitar de Favoritos' : 'Añadir a Favoritos', () => this.toggleFavorite(resource.id), 'studio-resource-star' + (favorite ? ' active' : ''));icon(star,'favorite','Favorito',true);
    star.setAttribute('aria-label', (favorite ? 'Quitar ' : 'Añadir ') + resource.name + (favorite ? ' de Favoritos' : ' a Favoritos')); star.setAttribute('aria-pressed', String(favorite)); card.appendChild(star);
    const actions=node('div','studio-resource-card-actions');const ficha=button('Ficha','Ver modelo, propiedades y opciones de '+resource.name,()=>this.select(resource),'studio-resource-sheet-link');icon(ficha,'info');ficha.setAttribute('data-resource-sheet',resource.id);actions.appendChild(ficha);
    if (this.options.onDocumentation && (resource.articleId || resource.documentationLinks && resource.documentationLinks.length)) {const docs = button('Doc', 'Abrir la documentación de ' + resource.name, () => this._documentation(resource), 'studio-library-doc-link');icon(docs,'book'); docs.setAttribute('data-resource-documentation', resource.articleId || resource.documentationLinks[0].articleId); actions.appendChild(docs);}card.appendChild(actions);
    this.grid.appendChild(card); this.cards.set(resource.id, choose);
    if (resource.thumbnail && resource.thumbnail.type === 'documentation' && /^modules\/logistica-industrial\/documentation\/assets\/[A-Z]{2}-\d{2}\.png$/.test(resource.thumbnail.src || '')) {const image = node('img', 'studio-library-concept-image'); image.src = resource.thumbnail.src; image.alt = resource.thumbnail.alt || 'Esquema conceptual'; image.loading = 'lazy'; thumbnail.appendChild(image);}
    else if (this.active && this.listingVisible && this._moduleAvailable(resource) && this.thumbnails && (resource.asset || resource.thumbnail && resource.thumbnail.type === 'procedural')) this.thumbnails.attach(resource.asset || {path: this._thumbnailKey(resource), name: resource.name, extension: '3d', kind: 'model'}, thumbnail);
    else {const placeholder=node('span','editor-asset-thumbnail-type');icon(placeholder,resource.kind==='scene'?'environment':resource.asset&&resource.asset.kind==='audio'?'sound':'cube');thumbnail.appendChild(placeholder);}
  }
  _thumbnailKey(resource) { return 'studio-resource/' + resource.id; }
  select(resource) {
    if (typeof resource === 'string') resource = this.resources.find(item => item.id === resource);
    if (!resource) return;
    if (!this._moduleAvailable(resource)) {this.clearPreview(); this._message('Activa el módulo de este recurso para previsualizarlo o insertarlo. Su ficha conceptual permanece accesible.'); return false;}
    this.state.selected = resource.id; this.previewSelection = resource; this._saveState(); this._call('onSelect', resource);
    const family=this._family(resource);if(family)this.familySelections.set(family.id,resource.id);
    this.cards.forEach((card, id) => { card.setAttribute('aria-pressed', String(id === resource.id)); card.parentNode.classList.toggle('selected', id === resource.id); });
    if (this.active && this.previewVisible && this.previewResource !== resource.id) this._renderPreview(resource);
    this.renderSignature = '';
    if(this.tab==='library'&&family&&!this.cards.has(resource.id))this.render();
  }
  place(resource, settings = {}) {
    if (!resource || !resource.action || resource.status === 'development') { this._message(resource && resource.reason || 'Este recurso solo se puede previsualizar.'); return; }
    const current = this.resources.find(item => item.id === resource.id);
    if (!current || !this._canInsert(current)) {this._message('El recurso requiere un módulo disponible y permiso de edición. Actualiza la biblioteca.'); return false;}
    try {if(this.invalidConfigurations.has(current.id))throw new Error('Corrige los parámetros antes de añadir este equipo.');const parameters=this._configuration(current,settings.parameters).values;this._call('onPlace', current,{parameters});return true;}
    catch(error){this._message(error.message);return false;}
  }
  dropEvent(event) {
    const id = event.dataTransfer && event.dataTransfer.getData(MIME);
    if (!id) return false;
    const resource = this.resources.find(item => item.id === id);
    if (!resource) { this._message('El recurso arrastrado ya no está disponible en este proyecto.'); return true; }
    event.preventDefault();
    if(!this._canInsert(resource)){this.place(resource);return true;}
    const raw=event.dataTransfer.getData(PRESET_MIME);
    if(raw){
      try {if(raw.length>16384)throw new Error('La configuración arrastrada es demasiado extensa.');const preset=JSON.parse(raw);if(!preset||preset.version!==1||preset.resourceId!==id||preset.projectId!==this.projectId||preset.roomId!==this.sceneRoomId)throw new Error('La configuración arrastrada pertenece a otra escena o recurso.');this.place(resource,{parameters:this._configuration(resource,preset.parameters).values});}
      catch(error){this._message(error.message||'No se pudo validar la configuración arrastrada.');}
    }else this.place(resource);
    return true;
  }
  clearPreview() {
    if(this.previewRefresh!==null){clearTimeout(this.previewRefresh);this.previewRefresh=null;}
    this.previewToken++; this.previewResource = null;
    if (this.previewContent && this.library.cancelPreview) this.library.cancelPreview(this.previewContent);
    if (this.previewCleanup) this.previewCleanup();
    this.previewCleanup = null; this.previewContent = null;
  }
  _renderConfiguration(resource) {
    let schema;try{schema=this._configuration(resource);}catch(error){this.preview.appendChild(node('p','ed-error',error.message));return;}
    if(!schema.fields.length)return;
    this.invalidConfigurations.delete(resource.id);
    const form=node('fieldset','studio-resource-configuration');form.setAttribute('data-resource-configuration',resource.id);form.appendChild(node('legend','','Configurar antes de añadir'));
    form.appendChild(node('p','ed-hint','Ajusta esta variante. Los cambios se aplican a la nueva instancia y a su vista previa.'));
    const message=node('p','ed-error');message.setAttribute('aria-live','polite');
    const currentValues=Object.assign({},schema.values);
    const updateInsert=()=>Array.from(this.preview.querySelectorAll('button')).filter(control=>control.getAttribute('data-resource-insert')===resource.id).forEach(control=>{control.disabled=this.invalidConfigurations.has(resource.id)||!this._canInsert(resource);});
    schema.fields.forEach(field=>{
      const label=node('label','studio-resource-configuration-field',field.label||field.key),input=node(field.type==='select'?'select':'input');input.setAttribute('data-resource-parameter',field.key);input.setAttribute('aria-label',field.label||field.key);
      if(field.type==='select'){(field.options||[]).forEach(choice=>{const value=typeof choice==='object'?choice.value:choice,option=node('option','',typeof choice==='object'?choice.label||String(value):String(value));option.value=String(value);input.appendChild(option);});input.value=String(schema.values[field.key]);}
      else if(field.type==='checkbox'){input.type='checkbox';input.checked=schema.values[field.key];}
      else {input.type='number';input.value=String(schema.values[field.key]);if(Number.isFinite(field.min))input.min=String(field.min);if(Number.isFinite(field.max))input.max=String(field.max);input.step=Number.isFinite(field.step)?String(field.step):'any';}
      input.disabled=!this._insertionPermitted();
      input.addEventListener('change',()=>{
        if(this.previewRefresh!==null){clearTimeout(this.previewRefresh);this.previewRefresh=null;}
        currentValues[field.key]=field.type==='checkbox'?input.checked:field.type==='number'?(input.value.trim()===''?NaN:Number(input.value)):(field.options||[]).map(choice=>typeof choice==='object'?choice.value:choice).find(value=>String(value)===input.value);
        try {const valid=this._configuration(resource,currentValues);this.configurationDrafts.set(resource.id,valid.values);this.invalidConfigurations.delete(resource.id);message.textContent='';
          const projectId=this.projectId;this.previewRefresh=setTimeout(()=>{this.previewRefresh=null;if(this.active&&this.previewVisible&&projectId===this.projectId&&this.state.selected===resource.id)this._renderPreview(this.resources.find(item=>item.id===resource.id)||resource);},120);
        }catch(error){this.invalidConfigurations.add(resource.id);message.textContent=error.message;}updateInsert();
      });label.appendChild(input);if(field.unit)label.appendChild(node('small','',field.unit));form.appendChild(label);
    });form.appendChild(message);this.preview.appendChild(form);return form;
  }
  async _renderPreview(resource) {
    if (!this.active || !this.previewVisible || !this._moduleAvailable(resource)) return;
    this.clearPreview(); const token = this.previewToken; this.previewResource = resource.id;
    this.preview.textContent = ''; this.preview.appendChild(node('strong', 'ed-preview-title', resource.name));
    const family=this._family(resource),variants=family&&this._variants(resource);
    if (family) {
      const familyTitle=node('p','studio-resource-family-heading',family.name+' · '+variants.length+' variantes');familyTitle.setAttribute('data-resource-family',family.id);this.preview.appendChild(familyTitle);
      if(variants.length>1){const label = node('label', 'studio-resource-variant', 'Variante');
      const select = node('select','studio-resource-variant-select'); select.setAttribute('aria-label', 'Variante del equipo');select.setAttribute('data-resource-family-selector',family.id);
      // Choosing a sibling is an explicit request, unlike the search that led
      // here. Keep its category/domain, but retire an incompatible search term.
      const inContext=item=>{
        if(!this._moduleAvailable(item)||!this._matchesDomain(item))return false;
        if(this.tab==='favorites'&&!this.organization.favorites.includes(item.id))return false;
        if(this.state.status!=='all'&&item.status!==this.state.status)return false;
        if(this.state.kind!=='all'&&(this.state.kind==='equipment'?item.kind!=='equipment'&&item.category!=='industrial':item.kind!==this.state.kind&&(!item.asset||item.asset.kind!==this.state.kind)))return false;
        const folder=this.state.folder;if(!folder)return true;
        if(folder.startsWith('origin:'))return item.origin===folder.slice(7);
        if(folder.startsWith('group:'))return taxonomy.matchesPath(item,folder);
        const[category,subcategory,mechanism]=folder.split('/');return item.category===category&&(!subcategory||item.subcategory===subcategory)&&(!mechanism||item.family===mechanism);
      };
      variants.forEach(item => { const option = node('option', '', item.name); option.value = item.id;option.disabled=!inContext(item); select.appendChild(option); });
      select.value = resource.id; select.addEventListener('change', () => {
        const next=this.resources.find(item=>item.id===select.value);
        if(!next||!inContext(next)){select.value=resource.id;return;}
        if(!catalog.matches(next,this.state.query))this.state.query='';
        this.select(next);
      }); label.appendChild(select); this.preview.appendChild(label);}
    }
    this.preview.appendChild(node('span', 'studio-resource-status studio-resource-status--' + resource.status, catalog.STATUS[resource.status] || resource.status));
    const description = node('p', 'studio-resource-preview-description', resource.description); this.preview.appendChild(description);
    const actions = node('div', 'studio-resource-actions');
    if (resource.subcategory === 'conveyors' && resource.equipmentId && this.options.onExploreEquipment) actions.appendChild(button('Explorar equipo', 'Consultar partes, funcionamiento, controles, conexiones y aplicaciones del modelo real', () => this._call('onExploreEquipment', resource)));
    if (resource.action) {const insert = button(resource.action.type === 'scene' ? 'Abrir escenario' : resource.action.type === 'workspace' ? 'Editar recurso' : '+ Añadir al escenario', resource.action.type === 'workspace' ? 'Abrir su espacio de trabajo' : 'Crear una instancia independiente del recurso', () => this.place(resource), 'primary'); insert.setAttribute('data-resource-insert',resource.id);insert.disabled = !this._canInsert(resource); actions.appendChild(insert);}
    else if (resource.reason) this.preview.appendChild(node('p', 'studio-resource-pending', resource.reason));
    if (this.options.onDocumentation && (resource.articleId || resource.documentationLinks && resource.documentationLinks.length)) actions.appendChild(button('▤ Documentación y concepto', 'Abrir ficha, imagen, conexiones y funcionamiento documentado', () => this._documentation(resource)));
    if (resource.asset && resource.asset.kind === 'image' && this.options.onImageAction) {
      actions.appendChild(button('Colocar decal', 'Proyectar esta imagen sobre una superficie', () => this._call('onImageAction', resource.asset, 'decal')));
      if (!this.options.canApplyTexture || this.options.canApplyTexture()) actions.appendChild(button('Usar como textura', 'Aplicar a la parte seleccionada en Material', () => this._call('onImageAction', resource.asset, 'texture')));
    }
    actions.appendChild(button(this.organization.favorites.includes(resource.id) ? '★ Favorito' : '☆ Favorito', 'Conservar una referencia sin duplicar archivos', () => this.toggleFavorite(resource.id)));
    if (resource.origin === 'project') {
      actions.appendChild(button('Renombrar', 'Cambiar el nombre visible conservando su identificador', () => this._editResource(resource)));
      actions.appendChild(button('Mover', 'Cambiar su carpeta lógica conservando las referencias', () => this._moveDialog(resource)));
      if (this.options.onDeleteResource && (resource.asset || resource.kind === 'template')) actions.appendChild(button('Eliminar…', 'Comprobar usos antes de eliminar la referencia', () => this._deleteDialog(resource)));
    }
    actions.setAttribute('aria-label', 'Acciones del recurso seleccionado');
    this.preview.appendChild(actions);
    const configuration=this._renderConfiguration(resource);
    const content = node('div', 'ed-preview-content studio-resource-preview-content'); this.previewContent = content; this.preview.appendChild(content);
    if (resource.articleId && resource.thumbnail && /^modules\/logistica-industrial\/documentation\/assets\/[A-Z]{2}-\d{2}\.png$/.test(resource.thumbnail.src || '')) {const image = node('img', 'studio-library-concept-preview'); image.src = resource.thumbnail.src; image.alt = resource.thumbnail.alt || 'Esquema conceptual'; content.appendChild(image); content.appendChild(node('p', 'ed-hint', 'Ilustración conceptual del documento; no es un equipo 3D insertable.'));}
    const details = node('dl', 'studio-resource-metadata');
    const row = (label, value) => { if (value === undefined || value === null || value === '') return; details.appendChild(node('dt', '', label)); details.appendChild(node('dd', '', String(value))); };
    row('Origen', resource.origin === 'project' ? 'Este proyecto' : 'Biblioteca incluida'); row('Referencia', resource.id); row('Versión', resource.version); row('Nombre técnico', resource.technicalName);
    if (resource.asset) { row('Ruta original', resource.asset.path); row('Tamaño', size(resource.asset.size)); }
    row('Unidades', resource.dimensions && resource.dimensions.units); row('Componentes', (resource.components || []).join(' · ')); row('Parámetros', (resource.parameters || []).join(' · ')); row('Puertos', (resource.ports || []).join(' · ')); row('Simulación', resource.simulation ? 'Modelo didáctico: ' + resource.simulation : 'Sin comportamiento de simulación añadido');
    if (resource.equipmentId) {
      row('Familia', family && family.name); row('Identidad equipo', resource.equipmentId); row('Versión equipo', resource.equipmentVersion);
      row('Productos', (resource.productProfiles || []).map(profile => typeof profile === 'string' ? profile : profile.name || profile.id).join(' · '));
      row('Valores', 'Dimensiones y límites configurables son valores didácticos del simulador; no son prestaciones comerciales.');
      row('Referencias', (resource.references || []).map(reference => typeof reference === 'string' ? reference : reference.title || reference.name || reference.url).join(' · '));
    }
    row('Licencia', resource.license); this.preview.appendChild(details);
    // One scrollable sheet and an always-visible action footer. Keep the same
    // preview/media nodes; moving them never creates another WebGL renderer.
    const sheet = node('div', 'studio-resource-sheet-content');
    Array.from(this.preview.children).filter(child => ![actions, description, content, details, configuration].includes(child)).forEach(child => sheet.appendChild(child));
    sheet.appendChild(content);if(configuration)sheet.appendChild(configuration);sheet.appendChild(description); sheet.appendChild(details);
    this.preview.appendChild(sheet); this.preview.appendChild(actions);
    try {
      let cleanup;
      const parameters=this._configuration(resource).values;
      if (this.options.onPreview) cleanup = await this.options.onPreview(resource, content,{parameters});
      else if (resource.asset) cleanup = await this.library.preview(resource.asset, content);
      else if (resource.thumbnail && resource.thumbnail.type === 'procedural') {
        const object = this.options.createConfiguredPrefab && resource.action && resource.action.type==='prefab' ? await this.options.createConfiguredPrefab(resource,parameters) : procedural(resource), disposers = [() => disposeObject(object)];
        try { this.library.previewModel(object, content, disposers); cleanup = () => disposers.splice(0).reverse().forEach(dispose => dispose()); }
        catch (error) { disposers.splice(0).reverse().forEach(dispose => dispose()); throw error; }
      }
      if (token !== this.previewToken || !this._moduleAvailable(resource)) { if (cleanup) cleanup(); return; }
      this.previewCleanup = cleanup;
    } catch (error) { if (token === this.previewToken) content.appendChild(node('p', 'ed-error', error.message || 'No se pudo abrir la vista previa.')); }
  }
  _mutate(change) {
    const projectId = this.projectId;
    const pending = this.mutationQueue.then(() => projectId === this.projectId ? this._commitMutation(change) : false);
    this.mutationQueue = pending.catch(() => false);
    return pending;
  }
  async _commitMutation(change) {
    const next = catalog.normalizeOrganization(JSON.parse(JSON.stringify(this.organization)));
    change(next);
    try {
      // The shared document uses null for a root folder. Empty strings are only
      // the browser's internal navigation sentinel, never a project reference.
      const payload = Object.assign({}, next, {folders: next.folders.map(folder => Object.assign({}, folder, {parentId: folder.parentId || null}))});
      if (this.options.onChange) await this.options.onChange(payload);
      this.organization = catalog.normalizeOrganization(payload); this.renderSignature = ''; this.previewResource = null; this.render(); return true;
    } catch (error) { this._message(error.message || 'No se pudieron guardar los cambios del navegador.'); return false; }
  }
  toggleFavorite(id) { return this._mutate(next => { const index = next.favorites.indexOf(id); if (index < 0) next.favorites.push(id); else next.favorites.splice(index, 1); }); }
  moveResource(resource, folderId) {
    if (!resource || resource.origin !== 'project') { this._message('Solo los recursos del proyecto se organizan en carpetas lógicas.'); return Promise.resolve(false); }
    if (!catalog.foldersFor(this.organization).some(folder => folder.id === folderId)) return Promise.resolve(false);
    return this._mutate(next => { let entry = next.resources.find(item => item.id === resource.id); if (!entry) { entry = {id: resource.id, name: resource.name, folderId}; next.resources.push(entry); } entry.folderId = folderId; });
  }
  _showDialog(title, build) {
    this.editDialog.textContent = ''; this.editDialog.hidden = false;
    const card = node('form', 'studio-resource-dialog-card'); card.appendChild(node('strong', '', title));
    const close = () => { this.editDialog.hidden = true; this.editDialog.textContent = ''; };
    build(card, close); this.editDialog.appendChild(card);
    this.editDialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }, {once: true});
    const field = card.querySelector && card.querySelector('input,select,button'); if (field) field.focus();
  }
  _editFolder(folder) {
    this._showDialog(folder ? 'Renombrar carpeta' : 'Nueva carpeta lógica', (form, close) => {
      const label = node('label', '', 'Nombre'); const input = node('input'); input.type = 'text'; input.required = true; input.maxLength = 160; input.value = folder ? folder.name : ''; label.appendChild(input); form.appendChild(label);
      form.appendChild(node('p', 'ed-hint', 'La organización es lógica: no mueve archivos en disco ni cambia referencias.'));
      const save = node('button', 'ed-button primary', folder ? 'Renombrar' : 'Crear'); save.type = 'submit'; form.appendChild(save); form.appendChild(button('Cancelar', 'Cerrar sin cambios', close));
      form.addEventListener('submit', async event => {
        event.preventDefault(); const name = input.value.trim(); if (!name) return;
        const ok = await this._mutate(next => {
          const id = folder ? folder.id : 'folder-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
          let entry = next.folders.find(item => item.id === id);
          if (!entry) { entry = {id, name, parentId: folder ? folder.parentId : this.state.folder || ''}; next.folders.push(entry); }
          entry.name = name;
        }); if (ok) close();
      });
    });
  }
  _editResource(resource) {
    this._showDialog('Renombrar recurso', (form, close) => {
      const label = node('label', '', 'Nombre visible'); const input = node('input'); input.required = true; input.maxLength = 160; input.value = resource.name; label.appendChild(input); form.appendChild(label);
      form.appendChild(node('p', 'ed-hint', 'El archivo original y sus instancias conservan su identificador y contenido.'));
      const save = node('button', 'ed-button primary', 'Renombrar'); save.type = 'submit'; form.appendChild(save); form.appendChild(button('Cancelar', 'Cerrar sin cambios', close));
      form.addEventListener('submit', async event => {
        event.preventDefault(); const name = input.value.trim(); if (!name) return;
        const ok = await this._mutate(next => { let entry = next.resources.find(item => item.id === resource.id); if (!entry) { entry = {id: resource.id, folderId: resource.folderId || ''}; next.resources.push(entry); } entry.name = name; }); if (ok) close();
      });
    });
  }
  _moveDialog(resource) {
    this._showDialog('Mover recurso', (form, close) => {
      const label = node('label', '', 'Carpeta de destino'); const select = node('select');
      catalog.foldersFor(this.organization).forEach(folder => { const option = node('option', '', folder.name); option.value = folder.id; select.appendChild(option); }); select.value = resource.folderId; label.appendChild(select); form.appendChild(label);
      const move = node('button', 'ed-button primary', 'Mover'); move.type = 'submit'; form.appendChild(move); form.appendChild(button('Cancelar', 'Cerrar sin cambios', close));
      form.addEventListener('submit', async event => { event.preventDefault(); if (await this.moveResource(resource, select.value)) close(); });
    });
  }
  async _deleteDialog(resource) {
    let uses;
    try { uses = this.options.onUsage ? await this.options.onUsage(resource) : null; }
    catch (error) { this._message(error.message || 'No se pudieron comprobar las referencias.'); return; }
    if (!Array.isArray(uses)) { this._message('No se puede eliminar el recurso hasta comprobar dónde se utiliza.'); return; }
    this._showDialog('Uso del recurso', (form, close) => {
      form.appendChild(node('p', '', resource.name));
      form.appendChild(node('p', 'ed-hint', uses.length ? 'Este recurso está en uso. Conserva sus referencias antes de eliminarlo.' : 'No se encontraron usos. Se eliminará su referencia del proyecto; los archivos compartidos del servidor se conservan.'));
      if (uses.length) { const list = node('ul'); uses.forEach(use => list.appendChild(node('li', '', typeof use === 'string' ? use : use.label || use.id))); form.appendChild(list); }
      const remove = button('Eliminar referencia', 'Eliminar solo un recurso sin usos', async () => {
        try {
          await this.options.onDeleteResource(resource);
          await this._mutate(next => { next.resources = next.resources.filter(item => item.id !== resource.id); next.favorites = next.favorites.filter(id => id !== resource.id); }); this.state.selected = ''; close(); this.refresh();
        } catch (error) { this._message(error.message || 'No se pudo eliminar el recurso.'); }
      }, 'danger'); remove.disabled = Boolean(uses.length); form.appendChild(remove); form.appendChild(button('Cancelar', 'Conservar el recurso', close));
      form.addEventListener('submit', event => event.preventDefault());
    });
  }
  dispose() {
    this.navigationDisposed = true;
    if (this.navigationObserver) {this.navigationObserver.disconnect(); this.navigationObserver = null;}
    this._saveState(); this.clearPreview();
    this.configurationDrafts.clear();this.familySelections.clear();this.invalidConfigurations.clear();
    this.setPreviewHost(null);
    if (this.thumbnails) { this.thumbnails.reset(); if (this.originalThumbnailLibrary) this.thumbnails.library = this.originalThumbnailLibrary; }
  }
}
