import SceneCatalogBrowser from './SceneCatalogBrowser.js';
import FloorPlanEditor from './FloorPlanEditor.js';
import DocumentationBrowser from '../../../documentation/DocumentationBrowser.js';
import {setEditorIcon} from './EditorIcons.js';

const LAYOUT_KEY = 'hello-studio-layout-v2';
const LEGACY_LAYOUT_KEY = 'hello-studio-layout-v1';
const DEFAULT_LAYOUT = {left: 480, right: 304, bottom: 248, hierarchy: true, inspector: true, resources: true};

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function button(label, action, className = '') {
  const result = node('button', 'ed-button ' + className, label); result.type = 'button';
  result.addEventListener('click', action); return result;
}
function icon(element,name,label,compact=false) {
  if(typeof setEditorIcon==='function')return setEditorIcon(element,name,label,compact);
  element.setAttribute('data-ed-icon',name);if(label!==undefined)element.textContent=label;
  if(compact){element.classList.add('ed-icon-only');element.setAttribute('aria-label',label||element.title||element.textContent);}
  return element;
}
function contains(parent, target) {
  for (let current = target; current; current = current.parentNode) if (current === parent) return true;
  return false;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || min)); }

/** Desktop authoring shell. Actions retain their original editor/runtime owner. */
export default class EditorShell {
  constructor(editor) {
    this.editor = editor;
    this.ui = editor.ui;
    this.layout = Object.assign({}, DEFAULT_LAYOUT);
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
      if(!saved){const legacy=JSON.parse(localStorage.getItem(LEGACY_LAYOUT_KEY)||'null');if(legacy&&typeof legacy==='object'){if(typeof legacy.right==='number')this.layout.right=legacy.right;if(typeof legacy.inspector==='boolean')this.layout.inspector=legacy.inspector;}}
      if (saved && typeof saved === 'object') Object.keys(DEFAULT_LAYOUT).forEach(key => {
        if (typeof saved[key] === typeof DEFAULT_LAYOUT[key]) this.layout[key] = saved[key];
      });
    } catch (_) { /* A blocked browser preference store does not block editing. */ }
    this.menus = []; this.menuIndex = -1; this.workspace = null;this.mobilePanel='scene';
    this.sceneCatalog = null;
    if (editor.resourceBrowser && editor.resourceBrowser.options) editor.resourceBrowser.options.onScenes = () => this.openSceneCatalog();
    this.ui.classList.add('ed-studio');this.ui.classList.add('ed-light');
    this.buildToolbar(); this.buildMenus(); this.buildWorkspace(); this.buildSplitters(); this.buildPreviewControls(); this.buildPanelDock();
    this.applyLayout();
    if(window.addEventListener)window.addEventListener('resize',()=>this.applyLayout(false));
    document.addEventListener('pointerdown', event => { if (this.menuIndex >= 0 && !contains(this.menubar, event.target)) this.closeMenus(); });
    document.addEventListener('keydown', event => {
      if (event.code === 'Escape' && this.menuIndex >= 0) { event.preventDefault(); this.closeMenus(true); }
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => { if (editor.active) editor.resize(); });
      this.observer.observe(editor.viewport);
    }
  }

  run(action) {
    this.closeMenus();
    try { const result = action(); if (result && result.catch) result.catch(error => this.editor.toast(error.message)); return result; }
    catch (error) { this.editor.toast(error.message); }
  }

  studio(method, ...args) {
    const tools = this.editor.studioTools;
    if (!tools || typeof tools[method] !== 'function') return this.editor.toast('Las herramientas del proyecto se están preparando. Vuelve a intentarlo.');
    return tools[method](...args);
  }

  openFloorPlan(object) {
    if (!this.floorPlan) this.floorPlan = new FloorPlanEditor(this.editor);
    return this.floorPlan.open(object);
  }

  requestSceneName({title = 'Nuevo escenario', value = 'Nuevo escenario', confirmLabel = 'Crear'} = {}) {
    if (this.sceneNameRequest) return this.sceneNameRequest;
    this.closeMenus(); this.editor.clearNavigation();
    const previousFocus = document.activeElement;
    const dialog = node('dialog', 'ed-scene-name-dialog');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', title);
    const form = node('form'); form.appendChild(node('h2', '', title));
    const label = node('label', '', 'Nombre del nivel');
    const input = node('input'); input.type = 'text'; input.required = true; input.maxLength = 160; input.value = value;
    input.setAttribute('aria-label', 'Nombre del nivel'); label.appendChild(input); form.appendChild(label);
    const error = node('p', 'ed-error'); error.setAttribute('aria-live', 'polite'); form.appendChild(error);
    const actions = node('div', 'ed-actions');
    const cancel = button('Cancelar', () => finish(null));
    const submit = button(confirmLabel, () => {}, 'primary'); submit.type = 'submit';
    actions.appendChild(cancel); actions.appendChild(submit); form.appendChild(actions); dialog.appendChild(form);
    let resolveRequest;
    const request = new Promise(resolve => { resolveRequest = resolve; });
    this.sceneNameRequest = request;
    const finish = result => {
      if (this.sceneNameRequest !== request) return;
      this.sceneNameRequest = null;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolveRequest(result);
    };
    form.addEventListener('submit', event => {
      event.preventDefault(); event.stopPropagation();
      const name = input.value.trim();
      if (!name || name.length > 160) { error.textContent = 'Escribe un nombre de 1 a 160 caracteres.'; input.focus(); return; }
      finish(name);
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    dialog.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.code === 'Escape') { event.preventDefault(); finish(null); }
      else if (event.code === 'Tab') {
        const fields = [input, cancel, submit], index = fields.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0 || !event.shiftKey && index === fields.length - 1) {
          event.preventDefault(); fields[event.shiftKey ? fields.length - 1 : 0].focus();
        }
      }
    });
    this.ui.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.classList.add('ed-scene-name-fallback'); }
    input.focus(); if (typeof input.select === 'function') input.select();
    return request;
  }

  buildToolbar() {
    const editor = this.editor, toolbar = editor.toolbar;
    const old = Array.from(toolbar.children);
    this.actionBank = node('div', 'ed-action-bank'); this.actionBank.hidden = true;
    old.forEach(child => this.actionBank.appendChild(child));
    this.ui.appendChild(this.actionBank);
    toolbar.appendChild(editor.brand);
    this.newButton = button('Nuevo escenario', () => this.run(() => this.studio('newScene')), 'ed-primary-command');icon(this.newButton,'new');
    this.newButton.title = 'Crear un escenario en una sala disponible'; toolbar.appendChild(this.newButton);
    toolbar.appendChild(editor.saveButton);icon(editor.saveButton,'save');
    const guide = button('Guía', () => editor.sceneGuide ? editor.sceneGuide.open() : editor.toast('La guía se está preparando.'));
    guide.title = 'Construir un escenario a partir de instrucciones';icon(guide,'guide');toolbar.appendChild(guide);
    const documentation=button('Documentación', () => this.openDocumentation(), 'ed-documentation-open');icon(documentation,'book');toolbar.appendChild(documentation);
    const practices=button('Prácticas', () => this.openWorkspace('practices'), 'ed-practices-open');icon(practices,'practice');toolbar.appendChild(practices);
    this.transformBar=node('div','ed-viewport-commandbar');this.transformBar.setAttribute('role','toolbar');this.transformBar.setAttribute('aria-label','Seleccionar, transformar e historial');this.transformBar.appendChild(editor.undoButton);this.transformBar.appendChild(editor.redoButton);
    const tools = node('div', 'ed-toolbar-group'); tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', 'Herramienta de transformación');
    this.selectButton = button('Seleccionar', () => editor.setTool('select'));icon(this.selectButton,'select','Seleccionar',true);
    this.selectButton.title = 'Seleccionar sin transformar el objeto'; editor.toolButtons.select = this.selectButton;
    tools.appendChild(this.selectButton);
    ['translate', 'rotate', 'scale'].forEach(mode => {const control=editor.toolButtons[mode];icon(control,{translate:'move',rotate:'rotate',scale:'scale'}[mode],{translate:'Mover',rotate:'Rotar',scale:'Escalar'}[mode],true);tools.appendChild(control);});
    icon(editor.undoButton,'undo','Deshacer',true);icon(editor.redoButton,'redo','Rehacer',true);icon(editor.snapButton,'magnet',undefined,true);
    this.transformBar.appendChild(tools);this.transformBar.appendChild(editor.snapButton);editor.viewport.appendChild(this.transformBar);
    if (typeof editor.appendAudioControls === 'function') {this.audioControls = editor.appendAudioControls(toolbar);if(this.audioControls){this.audioControls.classList.add('ed-audio-controls');const audioToggle=this.audioControls.querySelector&&this.audioControls.querySelector('[data-industrial-audio-toggle]');if(audioToggle)icon(audioToggle,'sound',undefined,true);}}
    toolbar.appendChild(node('span', 'ed-toolbar-spacer'));
    this.playButton = editor.playButton;this.playButton.textContent='Probar';icon(this.playButton,'play');toolbar.appendChild(this.playButton);
    // Optional services own their launchers and event handlers. Reuse those
    // exact nodes when they mount instead of constructing a second action.
    this.voiceButton=null;this.microphoneButton=null;this.assistantButton=null;
    this.accountButton = button('Cuenta', () => {
      if (editor.ctx.studio && editor.ctx.studio.open) editor.ctx.studio.open('account');
      else editor.toast('La cuenta se está preparando. Vuelve a intentarlo.');
    }, 'ed-account');
    icon(this.accountButton,'account');this.accountButton.setAttribute('aria-label', 'Abrir cuenta y espacio personal'); toolbar.appendChild(this.accountButton);
    this.syncAssistanceControls();
    if(typeof MutationObserver!=='undefined'){
      this.assistanceObserver=new MutationObserver(()=>this.syncAssistanceControls());
      this.assistanceObserver.observe(toolbar,{childList:true});
    }
    // Preserve the established creation adapters for existing integrations while
    // placing their user-facing actions in Añadir and the resource browser.
    Array.from(editor.hierarchy.children).forEach(child => {
      if (child === editor.tree || child === editor.treeSearch || child === editor.treeHeader) return;
      child.hidden = true;
    });
    editor.roomSelect.classList.add('ed-scene-picker');
    // Keep the original labels so a project without Studio names does not
    // inherit names from the project that was open before it.
    Array.from(editor.roomSelect.children).forEach(option => { option.setAttribute('data-default-label', option.textContent); });
    this.contextStrip=node('div','ed-context-strip');this.contextStrip.setAttribute('aria-label','Proyecto y nivel');this.ui.appendChild(this.contextStrip);
    this.sceneNavigation = node('nav', 'ed-scene-navigation ed-project-breadcrumb');
    this.sceneNavigation.setAttribute('aria-label', 'Proyecto y nivel activos');
    const home=button('Inicio',()=>{if(editor.ctx.studio&&editor.ctx.studio.goHome)editor.ctx.studio.goHome();else window.location.href='/';},'ed-breadcrumb-home');icon(home,'environment','Inicio',true);this.sceneNavigation.appendChild(home);
    if (!editor.projectButton) editor.projectButton = button('Proyecto: Sin guardar ▾', () => editor.projectLibrary.open('levels'), 'ed-project-current');
    icon(editor.projectButton,'folder');this.sceneNavigation.appendChild(editor.projectButton);
    editor.projectPath=node('button','ed-project-path');editor.projectPath.type='button';editor.projectPath.setAttribute('aria-label','Ver carpeta y contenido del proyecto');editor.projectPath.addEventListener('click',()=>editor.openProjectContent());icon(editor.projectPath,'info',undefined,true);editor.projectPath.title='Ver carpeta y contenido del proyecto';this.sceneNavigation.appendChild(editor.projectPath);
    const levelRow = node('div', 'ed-scene-navigation-level');
    levelRow.appendChild(node('span','ed-level-label','Nivel'));
    levelRow.appendChild(editor.roomSelect);
    this.browseProjectsButton = button('Otros proyectos…', () => editor.projectLibrary.open('levels'), 'ed-project-browse');
    this.browseProjectsButton.title = 'Buscar niveles guardados en otros proyectos';
    levelRow.appendChild(this.browseProjectsButton); this.sceneNavigation.appendChild(levelRow);
    this.contextStrip.appendChild(this.sceneNavigation);
    editor.roomSelect.title = 'Nivel del proyecto actual';
    editor.roomSelect.setAttribute('aria-label', 'Nivel del proyecto actual');
    // The existing tree is hosted by the inspector's Hierarchy tab.
    editor.assets.setAttribute('aria-label','Biblioteca y contenido del proyecto');
    editor.viewportHelp.hidden = true;
    const help = button('Controles', () => { editor.viewportHelp.hidden = !editor.viewportHelp.hidden; }, 'ed-context-help');
    icon(help,'info');help.setAttribute('aria-label', 'Mostrar u ocultar controles del editor'); editor.viewport.appendChild(help);
  }

  menuDefinitions() {
    const e = this.editor, mutate = action => () => e.perform(action), selected = () => Boolean(e.selected), canStudio = () => Boolean(e.studioTools);
    return [
      ['Archivo', [
        ['Nuevo proyecto…', () => e.projectLibrary.open('new')], ['Abrir proyecto…', () => e.projectLibrary.open()],
        ['Guardar', mutate(() => e.saveProject()), 'Ctrl S'], ['Guardar como…', () => e.projectLibrary.open('saveAs')],
        ['Guardar todo', mutate(() => e.saveProject()), '', () => !e.busy], null,
        ['Contenido y niveles del proyecto…', () => e.openProjectContent()], ['Módulos del proyecto…', () => e.projectModules&&e.projectModules.open()],
        ['Descargar proyecto independiente', () => e.exportContentProject()], ['Guardar carpeta de proyecto…', () => e.exportContentFolder()], ['Abrir carpeta de proyecto…', () => e.openContentFolder()], null,
        ['Importar archivos…', () => e.assetInput.click()], ['Importar proyecto JSON…', () => e.projectInput.click()],
        ['Exportar proyecto JSON', () => e.exportProject()], ['Compartir enlace', mutate(() => e.shareProject())],
        ['Proyectos recientes y versiones', () => e.projectLibrary.open()], ['Actualizar versión guardada', () => e.refreshRemoteProject(), '', () => Boolean(e.remoteProject)]
      ]],
      ['Editar', [
        ['Deshacer', mutate(() => e.historyStep('undo')), 'Ctrl Z', () => e.document.canUndo],
        ['Rehacer', mutate(() => e.historyStep('redo')), 'Ctrl Shift Z', () => e.document.canRedo], null,
        ['Copiar', mutate(() => e.copyObject()), 'Ctrl C', selected], ['Pegar', mutate(() => e.pasteObject()), 'Ctrl V', () => Boolean(e.objectClipboard)],
        ['Duplicar', mutate(() => e.duplicateObject()), 'Ctrl D', selected], ['Eliminar', mutate(() => this.removeSelection()), 'Supr', selected], null,
        ['Seleccionar todo', () => this.studio('selectAll'), 'Ctrl A', canStudio], ['Agrupar selección', () => this.studio('groupSelection'), 'Ctrl G', canStudio],
        ['Desagrupar', () => this.studio('ungroupSelection'), '', canStudio], ['Guardar como plantilla…', () => this.studio('saveTemplate'), '', selected]
      ]],
      ['Añadir', [
        ['Equipo de biblioteca', () => this.openResources('library')],
        ['Pasillos, zonas y textos de piso…', () => this.openFloorPlan()],
        ['Diseño paramétrico CAD…', () => e.cadWorkbench && e.cadWorkbench.open()],
        ['Estudiar equipo seleccionado · 2D / 3D', () => e.equipmentStudy && e.equipmentStudy.open(e.selected), '', () => Boolean(e.equipmentStudy && e.equipmentStudy.canStudy(e.selected))],
        ['Herramientas opcionales (compatibilidad)…', () => e.designTools && e.designTools.manage(), '', () => Boolean(e.designTools)],
        ['Monitor de producción', () => e.monitorWidgets && e.monitorWidgets.add()],
        ['Vincular monitor seleccionado…', () => e.monitorWidgets && e.monitorWidgets.openBinding(e.selected), '', selected],
        ...[['box', 'Cubo'], ['sphere', 'Esfera'], ['plane', 'Plano'], ['cylinder', 'Cilindro']].map(([kind, label]) => [label, mutate(() => e.createPlacedObject(() => e.document.addPrimitive(e.roomId, kind)))]),
        null, ['Luz', () => this.studio('addLight'), '', canStudio], ['Cámara', () => this.studio('addCamera'), '', canStudio],
        ['Decal de imagen', () => { this.openResources('project'); e.startDecalPlacement(); }],
        ['Widget', () => this.studio('addWidget'), '', canStudio], ['Audio y multimedia…', () => { this.openResources('project'); e.assetInput.click(); }],
        ['Zona de sonido', () => e.createAudioZone(), '', () => typeof e.createAudioZone === 'function'],
        ['Punto de aparición', () => this.studio('addSpawn'), '', canStudio], ['Zona de interacción', () => this.studio('addInteractionZone'), '', canStudio],
        ['Caja manipulable', mutate(() => e.createPlacedObject(() => e.document.addPrefab(e.roomId, 'product')))]
      ]],
      ['Escenario', [
        ['Prácticas · Logística y manufactura', () => this.openWorkspace('practices')],
        ['Catálogo de escenas…', () => this.openSceneCatalog()],
        ['Construir con instrucciones…', () => e.sceneGuide && e.sceneGuide.open()],
        ['Ver niveles del proyecto', () => this.openScenes()],
        ['Nuevo escenario', () => this.studio('newScene'), '', canStudio], ['Duplicar escenario…', () => this.studio('duplicateScene'), '', canStudio],
        ['Crear nivel de ejemplos industriales', () => this.studio('createIndustrialExamples'), '', canStudio],
          ['Crear escenarios CEDI avanzados', () => this.studio('createCediExamples'), '', canStudio],
        ['Integrar robótica y vehículos en este nivel', () => this.studio('integrateRobotics'), '', canStudio],
        ['Añadir almacén con misiones y recompensas', () => this.studio('addWarehouseMissionExperience'), '', canStudio],
        ['Renombrar escenario…', () => this.studio('renameScene'), '', canStudio], ['Usar como escenario inicial', () => this.studio('setStartScene'), '', canStudio],
        ['Administrar o eliminar niveles…', () => e.openProjectContent()],
        ['Configurar entorno', () => this.studio('configureEnvironment'), '', canStudio], null,
        ['Conectar equipos…', () => this.studio('connect'), '', canStudio], ['Ajuste de ensamblaje', () => e.assemblyButton.click(), '', () => true, () => e.assembly.enabled],
        ['Crear base vacía', () => e.emptyRoom()], ['Restaurar sala original', mutate(() => { e.document.resetRoom(e.roomId); e.select(null); })]
      ]],
      ['Simulación', [
        ['Ejecutar', () => { if (e.active) e.leave(); else e.simulationPaused = false; }],
        ['Pausar / continuar', () => { e.simulationPaused = !e.simulationPaused; e.toast(e.simulationPaused ? 'Simulación en pausa.' : 'Simulación reanudada.'); }, '', () => !e.active],
        ['Reiniciar', () => { e.enter(); e.leave(); }], null,
        ['Variables y parámetros', () => this.openWorkspace('signals')], ['Señales de entrada y salida', () => this.openWorkspace('signals')],
        ['Resultados y eventos', () => this.openWorkspace('results')]
      ]],
      ['Ventana', [
        ['Documentación del módulo', () => this.openDocumentation()],
        ['Biblioteca', () => this.openResources('library')], ['Proyecto', () => this.openResources('project')], ['Favoritos', () => this.openResources('favorites')],
        ['Jerarquía', () => this.setPanel('hierarchy', !this.layout.hierarchy), '', () => true, () => this.layout.hierarchy],
        ['Inspector', () => this.setPanel('inspector', !this.layout.inspector), '', () => true, () => this.layout.inspector], null,
        ['Editor de interfaz', () => this.openWorkspace('interface')], ['Lógica y misiones', () => this.openWorkspace('logic')],
        ['Resultados', () => this.openWorkspace('results')], ['Consola de eventos', () => this.openWorkspace('console')],
        ['Diagnóstico y rendimiento', () => { e.performancePanel.hidden = !e.performancePanel.hidden; e.resetPerformancePanel(); }], null,
        ['Ocultar / mostrar recursos', () => this.setPanel('resources', !this.layout.resources)], ['Restaurar distribución', () => this.restoreLayout()]
      ]],
      ['Ayuda', [
        ['Documentación de equipos y operaciones', () => this.openDocumentation()],
        ['Controles del editor', () => { e.viewportHelp.hidden = !e.viewportHelp.hidden; }],
        ['Enfocar selección', () => e.focus(), 'F'], ['Vista inicial', () => e.home()],
        ['Acerca de SMART-TWIN Simulator', () => this.openWorkspace('help')]
      ]]
    ];
  }

  buildMenus() {
    this.menubar = node('nav', 'ed-menubar'); this.menubar.setAttribute('role', 'menubar'); this.menubar.setAttribute('aria-label', 'Menú del editor');
    const back = button('←', () => this.editor.leave(), 'ed-menu-back'); back.title = 'Explorar el escenario'; this.menubar.appendChild(back);
    this.menuDefinitions().forEach(([label, definitions], index) => {
      const container = node('div', 'ed-menu');
      const trigger = button(label, () => this.menuIndex === index ? this.closeMenus() : this.openMenu(index), 'ed-menu-trigger');
      trigger.setAttribute('role', 'menuitem'); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
      const popup = node('div', 'ed-menu-popup'); popup.hidden = true; popup.setAttribute('role', 'menu'); popup.setAttribute('aria-label', label);
      const items = [];
      definitions.forEach(definition => {
        if (!definition) { const separator = node('hr'); separator.setAttribute('role', 'separator'); popup.appendChild(separator); return; }
        const [text, action, shortcut, enabled, checked] = definition;
        const item = button('', () => this.run(action), 'ed-menu-item');
        item.setAttribute('role', checked ? 'menuitemcheckbox' : 'menuitem');
        const mark = node('span', 'ed-menu-mark'); item.appendChild(mark); item.appendChild(node('span', '', text)); item.appendChild(node('kbd', '', shortcut || ''));
        popup.appendChild(item); items.push({node: item, enabled, checked, mark});
      });
      trigger.addEventListener('keydown', event => {
        if (['ArrowDown', 'ArrowUp'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); this.openMenu(index, event.code === 'ArrowUp' ? -1 : 1); }
        else if (['ArrowLeft', 'ArrowRight'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); this.focusMenu(index + (event.code === 'ArrowRight' ? 1 : -1)); }
      });
      trigger.addEventListener('pointerenter', () => { if (this.menuIndex >= 0 && this.menuIndex !== index) this.openMenu(index); });
      popup.addEventListener('keydown', event => this.menuKey(event, index));
      container.appendChild(trigger); container.appendChild(popup); this.menubar.appendChild(container);
      this.menus.push({trigger, popup, items});
    });
    this.ui.appendChild(this.menubar);
  }

  focusMenu(index) {
    index = (index + this.menus.length) % this.menus.length;
    this.openMenu(index); const trigger = this.menus[index].trigger; if (trigger.focus) trigger.focus();
  }
  openMenu(index, focus) {
    this.closeMenus(); this.menuIndex = index; this.editor.clearNavigation();
    const menu = this.menus[index]; menu.popup.hidden = false; menu.trigger.setAttribute('aria-expanded', 'true');
    menu.items.forEach(item => {
      item.node.disabled = Boolean(item.enabled && !item.enabled());
      if (item.checked) { const yes = Boolean(item.checked()); item.node.setAttribute('aria-checked', String(yes)); item.mark.textContent = yes ? '✓' : ''; }
    });
    if (focus) {
      const items = menu.items.filter(item => !item.node.disabled); const item = focus < 0 ? items[items.length - 1] : items[0];
      if (item && item.node.focus) item.node.focus();
    }
  }
  closeMenus(focus = false) {
    const previous = this.menuIndex;
    this.menus.forEach(menu => { menu.popup.hidden = true; menu.trigger.setAttribute('aria-expanded', 'false'); }); this.menuIndex = -1;
    if (focus && previous >= 0 && this.menus[previous].trigger.focus) this.menus[previous].trigger.focus();
  }
  menuKey(event, index) {
    if (['ArrowLeft', 'ArrowRight'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); this.focusMenu(index + (event.code === 'ArrowRight' ? 1 : -1)); return; }
    if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeMenus(true); return; }
    if (event.code === 'Tab') { this.closeMenus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation();
    const items = this.menus[index].items.filter(item => !item.node.disabled).map(item => item.node);
    let current = items.indexOf(document.activeElement);
    current = event.code === 'Home' ? 0 : event.code === 'End' ? items.length - 1 : (current + (event.code === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    if (items[current] && items[current].focus) items[current].focus();
  }

  buildWorkspace() {
    this.workarea = node('section', 'ed-workspace'); this.workarea.hidden = true;
    this.worktabs = node('div', 'ed-workspace-tabs'); this.worktabs.setAttribute('role', 'tablist');
    const scene=button('Escenario 3D',()=>this.closeWorkspace());icon(scene,'cube');this.worktabs.appendChild(scene);
    this.workspaceTabs = new Map();
    [['documentation', 'Documentación'], ['practices', 'Prácticas'], ['interface', 'Interfaz'], ['logic', 'Lógica y misiones'], ['signals', 'Señales'], ['results', 'Resultados'], ['console', 'Consola'], ['cameras', 'Cámaras']].forEach(([id, label]) => {
      const tab = button(label, () => this.openWorkspace(id)); tab.setAttribute('role', 'tab'); tab.hidden = !['documentation','practices'].includes(id);
      this.workspaceTabs.set(id, tab); this.worktabs.appendChild(tab);
    });
    this.practiceLaunch=button('Practicar',()=>this.run(()=>{const host=this.editor.ctx.studio&&this.editor.ctx.studio.practiceCampaign;if(host&&typeof host.openCatalogue==='function')return host.openCatalogue();throw Error('Las prácticas se están preparando. Vuelve a intentarlo.');}),'ed-practices-launch primary');icon(this.practiceLaunch,'play');this.practiceLaunch.hidden=true;this.worktabs.appendChild(this.practiceLaunch);
    const close=button('Cerrar',()=>this.closeWorkspace(),'ed-workspace-close');icon(close,'close','Cerrar',true);this.worktabs.appendChild(close);
    this.workcontent = node('div', 'ed-workspace-content'); this.workcontent.setAttribute('role', 'tabpanel');
    this.workarea.appendChild(this.worktabs); this.workarea.appendChild(this.workcontent); this.ui.appendChild(this.workarea);
  }

  buildPreviewControls() {
    this.previewControls = node('div', 'ed-preview-controls'); this.previewControls.hidden = true;
    this.previewPause = button('Ⅱ Pausar', () => {
      this.editor.simulationPaused = !this.editor.simulationPaused;
      this.previewPause.textContent = this.editor.simulationPaused ? '▶ Continuar' : 'Ⅱ Pausar';
      this.previewPause.setAttribute('aria-pressed', String(this.editor.simulationPaused));
    });
    this.previewControls.appendChild(this.previewPause);
    this.previewControls.appendChild(button('↺ Reiniciar', () => { this.editor.enter(); this.editor.leave(); }));
    this.previewControls.appendChild(button('▤ Resultados', () => this.editor.simulationPanel.toggle()));
    document.body.appendChild(this.previewControls);
  }
  modeChanged() {
    this.closeMenus();
    this.previewControls.hidden = this.editor.active || this.editor.ctx.vrMode || !this.editor.editorEnabled || Boolean(this.editor.canEditDocument && !this.editor.canEditDocument());
    this.previewPause.textContent = this.editor.simulationPaused ? '▶ Continuar' : 'Ⅱ Pausar';
    this.previewPause.setAttribute('aria-pressed', String(Boolean(this.editor.simulationPaused)));
    if (!this.editor.active && this.workspace) this.closeWorkspace();
  }

  openWorkspace(id) {
    this.closeMenus(); this.editor.clearNavigation(); this.workspace = id; this.workarea.hidden = false;this.practiceLaunch.hidden=id!=='practices';
    this.workarea.classList.toggle('ed-workspace-side', ['connections', 'environment'].includes(id));
    this.workarea.classList.toggle('ed-workspace-documentation', id === 'documentation');
    this.workarea.classList.toggle('ed-workspace-practices', id === 'practices');
    this.workspaceTabs.forEach((tab, key) => { if (key === id) tab.hidden = false; tab.classList.toggle('active', key === id); tab.setAttribute('aria-selected', String(key === id)); });
    if (this.editor.simulationPanel && this.editor.simulationPanel.panel.parentNode === this.workcontent) this.editor.simulationPanel.toggle(false);
    if (this.workcontent.dispatchEvent) this.workcontent.dispatchEvent(new Event('studio-workspace-close'));
    this.workcontent.textContent = '';
    if (id === 'practices') {
      this.workcontent.appendChild(node('p','','Cargando las prácticas…'));const host=this.workcontent,token={};this.practiceLoad=token;
      host.addEventListener('studio-workspace-close',()=>{if(this.practiceLoad===token)this.practiceLoad=null;if(token.browser)token.browser.dispose();},{once:true});
      import('../../../../modules/logistica-industrial/practices/ui/PracticeBrowser.js').then(value=>{
        if(this.practiceLoad!==token||this.workspace!=='practices')return;host.textContent='';token.browser=new value.default(host,{mode:'author',onClose:()=>{if(this.practiceLoad===token)this.closeWorkspace();},isAvailable:()=>!this.editor.projectModules||this.editor.projectModules.canShowLevel('sector.logistics-industrial'),
          onDocumentation:target=>this.openDocumentation(target),onPlay:()=>{const campaign=this.editor.ctx.studio&&this.editor.ctx.studio.practiceCampaign;if(campaign&&typeof campaign.openCatalogue==='function')return campaign.openCatalogue();throw Error('Las prácticas se están preparando. Vuelve a intentarlo.');},onCreate:async(id,options)=>{const result=await this.studio('createPracticeProject',id,options);if(this.practiceLoad===token&&this.workspace==='practices')this.closeWorkspace();return result;}});
      }).catch(error=>{if(this.practiceLoad===token){host.textContent='';host.appendChild(node('p','',error.message));}});
    } else if (id === 'documentation') {
      const editor = this.editor;
      this.documentation = new DocumentationBrowser(this.workcontent, {
        initialTarget: this.documentationTarget,
        getProviders: () => editor.studioTools && editor.studioTools.documentationProviders ? editor.studioTools.documentationProviders() : [],
        getContextKey: () => String(editor.currentProject && editor.currentProject.id || '') + ':' + editor.projectGeneration,
        getResources: () => editor.resourceBrowser ? editor.resourceBrowser.resources.filter(resource => !resource.moduleId || !editor.projectModules || editor.projectModules.canShowLevel(resource.moduleId)) : [],
        onResource: target => this.openDocumentationResource(target)
      });
      const current = this.documentation;
      this.workcontent.addEventListener('studio-workspace-close', () => { current.dispose(); if (this.documentation === current) this.documentation = null; }, {once: true});
      this.documentationTarget = null;
    } else if (id === 'signals' || id === 'results' || id === 'console') {
      const monitor = this.editor.simulationPanel;
      monitor.panel.classList.add('ed-docked-simulation'); this.workcontent.appendChild(monitor.panel); monitor.toggle(true); monitor.render(true);
    } else if (id === 'help') {
      this.workcontent.appendChild(node('h2', '', 'SMART-TWIN Simulator'));
      this.workcontent.appendChild(node('p', '', 'Editor de escenarios WebXR. Guarda la configuración del proyecto con Archivo → Guardar. Los resultados de simulación se guardan desde Resultados.'));
      this.workcontent.appendChild(node('p', '', 'Navega con WASD. Q sube y E baja. Espacio alterna mover, rotar y escalar. Ctrl C / Ctrl V copia el objeto con sus componentes. La experiencia inmersiva se abre desde Probar.'));
      this.workcontent.appendChild(node('p', '', 'Los equipos son modelos didácticos. El estado Funcional, Solo visual o En desarrollo de cada recurso indica su alcance real.'));
    } else this.studio('openWorkspace', id, this.workcontent);
    this.editor.resize();
  }

  closeWorkspace() {
    if (this.workcontent.dispatchEvent) this.workcontent.dispatchEvent(new Event('studio-workspace-close'));
    this.workarea.hidden = true; this.workspace = null;
    if (this.editor.simulationPanel && this.editor.simulationPanel.panel.parentNode === this.workcontent) {
      this.editor.simulationPanel.toggle(false); document.body.appendChild(this.editor.simulationPanel.panel);
      this.editor.simulationPanel.panel.classList.remove('ed-docked-simulation');
    }
    this.editor.resize();
  }

  openResources(tab) { this.setPanel('resources', true); if (this.editor.resourceBrowser) this.editor.resourceBrowser.openTab(tab); }
  openDocumentation(target) {
    this.documentationTarget = target || null;
    this.openWorkspace('documentation');
  }
  openDocumentationResource(target) {
    const editor = this.editor, browser = editor.resourceBrowser;
    if (!browser || target.moduleId && editor.projectModules && !editor.projectModules.canShowLevel(target.moduleId)) return;
    const resource = browser.resources.find(row => row.id === target.resourceId);
    if (!resource) return editor.toast('El recurso no está disponible en este proyecto.');
    this.closeWorkspace(); this.openResources('library');
    Object.assign(browser.state, {folder: '', query: resource.technicalName || resource.name, kind: 'all', status: 'all', scroll: 0});
    browser.refresh(); browser.select(resource.id);
    const card = browser.cards.get(resource.id); if (card && card.scrollIntoView) card.scrollIntoView({block: 'nearest'});
  }
  openScenes() {
    this.setPanel('resources', true);
    if (this.editor.resourceBrowser) this.editor.resourceBrowser.showScenes();
  }
  openSceneCatalog(source = 'included') { this.closeMenus(); if (!this.sceneCatalog) this.sceneCatalog = new SceneCatalogBrowser(this.editor); this.sceneCatalog.open(source); }
  removeSelection() {
    const selected = this.editor.studioTools ? this.editor.studioTools.objects() : [this.editor.selected];
    this.editor.document.begin();
    try { selected.filter(Boolean).forEach(object => this.editor.document.remove(object)); this.editor.document.commit(); this.editor.select(null); }
    catch (error) { this.editor.document.cancel(); throw error; }
  }

  buildSplitters() {
    this.splitters = {};
    [['left', 'vertical', 'Redimensionar biblioteca'], ['right', 'vertical', 'Redimensionar inspector'], ['bottom', 'horizontal', 'Redimensionar recursos']].forEach(([name, orientation, label]) => {
      const splitter = node('div', 'ed-splitter ed-splitter-' + name); splitter.tabIndex = 0;
      splitter.setAttribute('role', 'separator'); splitter.setAttribute('aria-orientation', orientation); splitter.setAttribute('aria-label', label);
      splitter.addEventListener('pointerdown', event => {
        if (event.button !== 0) return; event.preventDefault(); this.editor.clearNavigation();
        this.drag = {name, x: event.clientX, y: event.clientY, value: this.layout[name]};
        if (splitter.setPointerCapture) splitter.setPointerCapture(event.pointerId);
        this.ui.classList.add('ed-resizing');
      });
      splitter.addEventListener('pointermove', event => {
        if (!this.drag || this.drag.name !== name) return;
        const delta = name === 'bottom' ? this.drag.y - event.clientY : name === 'right' ? this.drag.x - event.clientX : event.clientX - this.drag.x;
        this.layout[name] = this.drag.value + delta; this.applyLayout(false);
      });
      const end = () => { if (!this.drag) return; this.drag = null; this.ui.classList.remove('ed-resizing'); this.applyLayout(); };
      splitter.addEventListener('pointerup', end); splitter.addEventListener('pointercancel', end); splitter.addEventListener('lostpointercapture', end);
      splitter.addEventListener('dblclick', () => { this.layout[name] = DEFAULT_LAYOUT[name]; this.applyLayout(); });
      splitter.addEventListener('keydown', event => {
        const directions = name === 'bottom' ? {ArrowUp: 24, ArrowDown: -24} : name === 'right' ? {ArrowLeft: 24, ArrowRight: -24} : {ArrowLeft: -24, ArrowRight: 24};
        if (directions[event.code]) { event.preventDefault(); event.stopPropagation(); this.layout[name] += directions[event.code]; this.applyLayout(); }
        if (event.code === 'Home') { event.preventDefault(); this.layout[name] = DEFAULT_LAYOUT[name]; this.applyLayout(); }
      });
      this.splitters[name] = splitter; this.ui.appendChild(splitter);
    });
    this.reopen = node('div', 'ed-reopen-panels');
    [['resources', 'Biblioteca'], ['inspector', 'Inspector'], ['hierarchy', 'Jerarquía']].forEach(([key, label]) => {
      const control = button(label, () => this.setPanel(key, true)); control.setAttribute('data-panel',key); this.reopen.appendChild(control);
    });
    this.editor.viewport.appendChild(this.reopen);
  }

  buildPanelDock() {
    this.panelDock=node('nav','ed-panel-dock');this.panelDock.setAttribute('aria-label','Paneles del editor');
    [['resources','Biblioteca'],['scene','Escena'],['object','Objeto'],['hierarchy','Jerarquía']].forEach(([pane,title])=>{const control=button(title,()=>this.showPanel(pane));control.setAttribute('data-editor-pane',pane);this.panelDock.appendChild(control);});this.ui.appendChild(this.panelDock);
  }
  showPanel(pane) {
    this.closeWorkspace();
    if(pane==='scene'){this.mobilePanel='scene';this.applyLayout(false);return;}
    if(pane==='resources'){this.setPanel('resources',true);return;}
    if(['object','resource','hierarchy'].includes(pane)){this.setPanel('inspector',true);if(this.editor.showInspectorTab)this.editor.showInspectorTab(pane);}
  }
  setPanel(name, show) {
    if(!['hierarchy','inspector','resources'].includes(name))return;
    this.layout[name]=Boolean(show);
    if(name==='hierarchy'){
      if(show){this.layout.inspector=true;this.mobilePanel='inspector';if(this.editor.showInspectorTab)this.editor.showInspectorTab('hierarchy');}
      else if(this.editor.inspectorTab==='hierarchy'&&this.editor.showInspectorTab)this.editor.showInspectorTab('object');
    }else if(show)this.mobilePanel=name;
    else if(this.mobilePanel===name)this.mobilePanel='scene';
    this.applyLayout();
  }
  restoreLayout() { this.layout=Object.assign({},DEFAULT_LAYOUT);this.mobilePanel='scene';this.closeWorkspace();this.applyLayout(); }
  applyLayout(persist = true) {
    const width=window.innerWidth||1280,narrow=width<=950,available=narrow?1280:width;
    this.layout.left=clamp(this.layout.left,300,Math.max(300,Math.min(560,available*.44)));
    this.layout.right=clamp(this.layout.right,230,Math.max(240,Math.min(490,available*.34)));
    this.ui.setAttribute('data-editor-panel',this.mobilePanel);
    this.ui.style.setProperty('--ed-left',this.layout.resources?this.layout.left+'px':'0px');
    this.ui.style.setProperty('--ed-right',this.layout.inspector?this.layout.right+'px':'0px');
    this.ui.style.setProperty('--ed-bottom','0px');
    this.editor.inspector.hidden=!this.layout.inspector||narrow&&this.mobilePanel!=='inspector';
    this.editor.hierarchy.hidden=this.editor.inspector.hidden||this.editor.inspectorTab!=='hierarchy';
    this.editor.assets.hidden=!this.layout.resources||narrow&&this.mobilePanel!=='resources';
    const resourcesActive=Boolean(this.editor.active);
    if(this.resourcesActive!==resourcesActive&&this.editor.resourceBrowser){this.resourcesActive=resourcesActive;this.editor.resourceBrowser.setActive(resourcesActive);}
    if(this.editor.resourceBrowser){
      if(this.editor.resourceBrowser.setListingVisible)this.editor.resourceBrowser.setListingVisible(!this.editor.assets.hidden);
      if(this.editor.resourceBrowser.setPreviewVisible)this.editor.resourceBrowser.setPreviewVisible(!this.editor.inspector.hidden&&this.editor.inspectorTab==='resource');
      this.editor.resourceBrowser.render();
    }
    ['left','right','bottom'].forEach(key=>{const splitter=this.splitters[key];splitter.hidden=key==='bottom'||narrow||!this.layout[key==='left'?'resources':'inspector'];splitter.setAttribute('aria-valuenow',Math.round(this.layout[key]));splitter.tabIndex=splitter.hidden?-1:0;});
    Array.from(this.reopen.children).forEach(control=>{const key=control.getAttribute('data-panel');control.hidden=key==='hierarchy'?this.layout.inspector&&this.editor.inspectorTab==='hierarchy':this.layout[key];});
    if(this.panelDock)Array.from(this.panelDock.children).forEach(control=>{const pane=control.getAttribute('data-editor-pane'),active=pane==='scene'?this.mobilePanel==='scene':pane==='resources'?this.mobilePanel==='resources':this.mobilePanel==='inspector'&&this.editor.inspectorTab===pane;control.setAttribute('aria-pressed',String(active));control.classList.toggle('active',active);});
    if(persist)try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(this.layout));}catch(_){}
    if(this.editor.orbit)this.editor.resize();
  }

  syncAssistanceControls() {
    const editor=this.editor,toolbar=editor.toolbar,ctx=editor.ctx||{},voice=ctx.voicePanel&&!ctx.voicePanel.disposed?ctx.voicePanel:null,assistant=ctx.assistantWorkspace&&!ctx.assistantWorkspace.disposed?ctx.assistantWorkspace:null;
    const controls=[['voiceButton',voice&&voice.launcher,'ed-voice-command'],['microphoneButton',voice&&voice.microphoneLauncher,'ed-microphone-command'],['assistantButton',assistant&&assistant.launcher,'ed-assistant-command']];
    controls.forEach(([key,control,className])=>{
      const previous=this[key];
      if(previous&&previous!==control&&previous.parentNode===toolbar)this.actionBank.appendChild(previous);
      this[key]=control||null;if(!control)return;
      control.classList.add('ed-button');control.classList.add(className);
      if(key==='microphoneButton')icon(control,'mic',undefined,true);
      else if(key==='assistantButton')icon(control,'assistant');
      else if(key==='voiceButton')icon(control,'voice');
    });
    // Voice modules move their own nodes back to the viewer when authoring
    // closes. Do not pull them into a hidden editor in that transition.
    if(editor.active===false||!this.accountButton)return;
    let before=this.accountButton;
    for(let index=controls.length-1;index>=0;index--){
      const control=controls[index][1];if(!control)continue;
      const children=Array.from(toolbar.children),position=children.indexOf(control),target=children.indexOf(before);
      if(control.parentNode!==toolbar||position!==target-1){
        if(toolbar.insertBefore)toolbar.insertBefore(control,before);else toolbar.appendChild(control);
      }
      before=control;
    }
  }

  refresh() {
    const e = this.editor, studio = e.document.studio || {};
    if(e.projectTabs&&e.projectTabs.bar&&e.projectTabs.bar.parentNode!==this.contextStrip)this.contextStrip.appendChild(e.projectTabs.bar);
    const entries = typeof e.getSceneEntries === 'function' ? e.getSceneEntries() : [];
    Array.from(e.roomSelect.children).forEach((option, index) => {
      const roomIndex = Number(option.value === undefined || option.value === '' ? index : option.value);
      const scene = entries.find(item => item.index === roomIndex);
      const id = scene ? scene.id : Object.keys(e.ctx.editorRoots)[roomIndex];
      const named = scene || (studio.scenes || []).find(item => item.id === id);
      const defaultLabel = option.getAttribute && option.getAttribute('data-default-label') || option.dataset && option.dataset.defaultLabel;
      option.textContent = (named ? named.name : defaultLabel || option.textContent) + (studio.startRoomId === id ? ' · inicial' : '');
    });
    const current = entries.find(item => item.id === e.roomId) || (studio.scenes || []).find(item => item.id === e.roomId);
    if (current) e.roomLabel.textContent = current.name;
    const user = e.ctx.studio && e.ctx.studio.user;
    this.accountButton.textContent = user ? user.displayName : 'Cuenta';
    this.syncAssistanceControls();
  }
}
