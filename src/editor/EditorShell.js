import SceneCatalogBrowser from './SceneCatalogBrowser.js';
import FloorPlanEditor from './FloorPlanEditor.js';

const LAYOUT_KEY = 'hello-studio-layout-v1';
const DEFAULT_LAYOUT = {left: 238, right: 304, bottom: 248, hierarchy: true, inspector: true, resources: true};

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
      if (saved && typeof saved === 'object') Object.keys(DEFAULT_LAYOUT).forEach(key => {
        if (typeof saved[key] === typeof DEFAULT_LAYOUT[key]) this.layout[key] = saved[key];
      });
    } catch (_) { /* A blocked browser preference store does not block editing. */ }
    this.menus = []; this.menuIndex = -1; this.workspace = null;
    this.sceneCatalog = null;
    if (editor.resourceBrowser && editor.resourceBrowser.options) editor.resourceBrowser.options.onScenes = () => this.openSceneCatalog();
    this.ui.classList.add('ed-studio');
    this.buildToolbar(); this.buildMenus(); this.buildWorkspace(); this.buildSplitters(); this.buildPreviewControls();
    this.applyLayout();
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
    this.newButton = button('▱ Nuevo escenario', () => this.run(() => this.studio('newScene')));
    this.newButton.title = 'Crear un escenario en una sala disponible'; toolbar.appendChild(this.newButton);
    toolbar.appendChild(editor.saveButton);
    const guide = button('Guía', () => editor.sceneGuide ? editor.sceneGuide.open() : editor.toast('La guía se está preparando.'));
    guide.title = 'Construir un escenario a partir de instrucciones'; toolbar.appendChild(guide);
    toolbar.appendChild(editor.undoButton); toolbar.appendChild(editor.redoButton);
    const tools = node('div', 'ed-toolbar-group'); tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', 'Herramienta de transformación');
    this.selectButton = button('↖ Seleccionar', () => editor.setTool('select'));
    this.selectButton.title = 'Seleccionar sin transformar el objeto'; editor.toolButtons.select = this.selectButton;
    tools.appendChild(this.selectButton);
    ['translate', 'rotate', 'scale'].forEach(mode => tools.appendChild(editor.toolButtons[mode]));
    toolbar.appendChild(tools); toolbar.appendChild(editor.snapButton);
    if (typeof editor.appendAudioControls === 'function') this.audioControls = editor.appendAudioControls(toolbar);
    toolbar.appendChild(node('span', 'ed-toolbar-spacer'));
    this.playButton = editor.playButton; toolbar.appendChild(this.playButton);
    this.accountButton = button('◉ Cuenta', () => {
      if (editor.ctx.studio && editor.ctx.studio.open) editor.ctx.studio.open('account');
      else editor.toast('La cuenta se está preparando. Vuelve a intentarlo.');
    }, 'ed-account');
    this.accountButton.setAttribute('aria-label', 'Abrir cuenta y espacio personal'); toolbar.appendChild(this.accountButton);
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
    this.sceneNavigation = node('div', 'ed-scene-navigation');
    this.sceneNavigation.setAttribute('aria-label', 'Proyecto y nivel activos');
    if (!editor.projectButton) editor.projectButton = button('Proyecto: Sin guardar ▾', () => editor.projectLibrary.open('levels'), 'ed-project-current');
    this.sceneNavigation.appendChild(editor.projectButton);
    const levelRow = node('div', 'ed-scene-navigation-level');
    levelRow.appendChild(editor.roomSelect);
    this.browseProjectsButton = button('Otros proyectos…', () => editor.projectLibrary.open('levels'), 'ed-project-browse');
    this.browseProjectsButton.title = 'Buscar niveles guardados en otros proyectos';
    levelRow.appendChild(this.browseProjectsButton); this.sceneNavigation.appendChild(levelRow);
    editor.viewport.appendChild(this.sceneNavigation);
    editor.roomSelect.title = 'Nivel del proyecto actual';
    editor.roomSelect.setAttribute('aria-label', 'Nivel del proyecto actual');
    const head = editor.treeHeader;
    head.appendChild(button('‹', () => this.setPanel('hierarchy', false), 'ed-panel-collapse'));
    editor.viewportHelp.hidden = true;
    const help = button('⌨ Controles', () => { editor.viewportHelp.hidden = !editor.viewportHelp.hidden; }, 'ed-context-help');
    help.setAttribute('aria-label', 'Mostrar u ocultar controles del editor'); editor.viewport.appendChild(help);
  }

  menuDefinitions() {
    const e = this.editor, mutate = action => () => e.perform(action), selected = () => Boolean(e.selected), canStudio = () => Boolean(e.studioTools);
    return [
      ['Archivo', [
        ['Nuevo proyecto…', () => e.projectLibrary.open('new')], ['Abrir proyecto…', () => e.projectLibrary.open()],
        ['Guardar', mutate(() => e.saveProject()), 'Ctrl S'], ['Guardar como…', () => e.projectLibrary.open('saveAs')],
        ['Guardar todo', mutate(() => e.saveProject()), '', () => !e.busy], null,
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
        ['Catálogo de escenas…', () => this.openSceneCatalog()],
        ['Construir con instrucciones…', () => e.sceneGuide && e.sceneGuide.open()],
        ['Ver niveles del proyecto', () => this.openScenes()],
        ['Nuevo escenario', () => this.studio('newScene'), '', canStudio], ['Duplicar escenario…', () => this.studio('duplicateScene'), '', canStudio],
        ['Crear nivel de ejemplos industriales', () => this.studio('createIndustrialExamples'), '', canStudio],
          ['Crear escenarios CEDI avanzados', () => this.studio('createCediExamples'), '', canStudio],
        ['Integrar robótica y vehículos en este nivel', () => this.studio('integrateRobotics'), '', canStudio],
        ['Renombrar escenario…', () => this.studio('renameScene'), '', canStudio], ['Usar como escenario inicial', () => this.studio('setStartScene'), '', canStudio],
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
        ['Biblioteca', () => this.openResources('library')], ['Proyecto', () => this.openResources('project')], ['Favoritos', () => this.openResources('favorites')],
        ['Jerarquía', () => this.setPanel('hierarchy', !this.layout.hierarchy), '', () => true, () => this.layout.hierarchy],
        ['Inspector', () => this.setPanel('inspector', !this.layout.inspector), '', () => true, () => this.layout.inspector], null,
        ['Editor de interfaz', () => this.openWorkspace('interface')], ['Lógica y misiones', () => this.openWorkspace('logic')],
        ['Resultados', () => this.openWorkspace('results')], ['Consola de eventos', () => this.openWorkspace('console')],
        ['Diagnóstico y rendimiento', () => { e.performancePanel.hidden = !e.performancePanel.hidden; e.resetPerformancePanel(); }], null,
        ['Ocultar / mostrar recursos', () => this.setPanel('resources', !this.layout.resources)], ['Restaurar distribución', () => this.restoreLayout()]
      ]],
      ['Ayuda', [
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
    this.worktabs.appendChild(button('◇ Escenario 3D', () => this.closeWorkspace()));
    this.workspaceTabs = new Map();
    [['interface', 'Interfaz'], ['logic', 'Lógica y misiones'], ['signals', 'Señales'], ['results', 'Resultados'], ['console', 'Consola'], ['cameras', 'Cámaras']].forEach(([id, label]) => {
      const tab = button(label, () => this.openWorkspace(id)); tab.setAttribute('role', 'tab'); tab.hidden = true;
      this.workspaceTabs.set(id, tab); this.worktabs.appendChild(tab);
    });
    this.worktabs.appendChild(button('×', () => this.closeWorkspace(), 'ed-workspace-close'));
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
    this.closeMenus(); this.editor.clearNavigation(); this.workspace = id; this.workarea.hidden = false;
    this.workarea.classList.toggle('ed-workspace-side', ['connections', 'environment'].includes(id));
    this.workspaceTabs.forEach((tab, key) => { if (key === id) tab.hidden = false; tab.classList.toggle('active', key === id); tab.setAttribute('aria-selected', String(key === id)); });
    if (this.editor.simulationPanel && this.editor.simulationPanel.panel.parentNode === this.workcontent) this.editor.simulationPanel.toggle(false);
    if (this.workcontent.dispatchEvent) this.workcontent.dispatchEvent(new Event('studio-workspace-close'));
    this.workcontent.textContent = '';
    if (id === 'signals' || id === 'results' || id === 'console') {
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
    [['left', 'vertical', 'Redimensionar jerarquía'], ['right', 'vertical', 'Redimensionar inspector'], ['bottom', 'horizontal', 'Redimensionar recursos']].forEach(([name, orientation, label]) => {
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
    [['hierarchy', 'Jerarquía'], ['inspector', 'Inspector'], ['resources', 'Recursos']].forEach(([key, label]) => {
      const control = button(label, () => this.setPanel(key, true)); control.dataset && (control.dataset.panel = key); this.reopen.appendChild(control);
    });
    this.editor.viewport.appendChild(this.reopen);
  }

  setPanel(name, show) { if (['hierarchy', 'inspector', 'resources'].includes(name)) { this.layout[name] = Boolean(show); this.applyLayout(); } }
  restoreLayout() { this.layout = Object.assign({}, DEFAULT_LAYOUT); this.closeWorkspace(); this.applyLayout(); }
  applyLayout(persist = true) {
    const width = window.innerWidth || 1280, height = window.innerHeight || 720;
    this.layout.left = clamp(this.layout.left, 155, Math.max(160, Math.min(420, width * .28)));
    this.layout.right = clamp(this.layout.right, 230, Math.max(240, Math.min(490, width * .34)));
    this.layout.bottom = clamp(this.layout.bottom, 140, Math.max(145, height - 300));
    this.ui.style.setProperty('--ed-left', this.layout.hierarchy ? this.layout.left + 'px' : '0px');
    this.ui.style.setProperty('--ed-right', this.layout.inspector ? this.layout.right + 'px' : '0px');
    this.ui.style.setProperty('--ed-bottom', this.layout.resources ? this.layout.bottom + 'px' : '0px');
    this.editor.hierarchy.hidden = !this.layout.hierarchy; this.editor.inspector.hidden = !this.layout.inspector; this.editor.assets.hidden = !this.layout.resources;
    const resourcesActive = Boolean(this.editor.active);
    if (this.resourcesActive !== resourcesActive && this.editor.resourceBrowser) {
      this.resourcesActive = resourcesActive; this.editor.resourceBrowser.setActive(resourcesActive); this.editor.resourceBrowser.render();
    }
    if (this.editor.resourceBrowser) {
      if (this.editor.resourceBrowser.setListingVisible) this.editor.resourceBrowser.setListingVisible(this.layout.resources);
      if (this.editor.resourceBrowser.setPreviewVisible) this.editor.resourceBrowser.setPreviewVisible(Boolean(this.layout.inspector && this.editor.inspectorTab === 'resource'));
      this.editor.resourceBrowser.render();
    }
    ['left', 'right', 'bottom'].forEach((key, index) => {
      this.splitters[key].hidden = !this.layout[['hierarchy', 'inspector', 'resources'][index]];
      this.splitters[key].setAttribute('aria-valuenow', Math.round(this.layout[key]));
    });
    Array.from(this.reopen.children).forEach((control, index) => { control.hidden = this.layout[['hierarchy', 'inspector', 'resources'][index]]; });
    if (persist) try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout)); } catch (_) { /* Layout remains usable for this visit. */ }
    if (this.editor.orbit) this.editor.resize();
  }

  refresh() {
    const e = this.editor, studio = e.document.studio || {};
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
    this.accountButton.textContent = user ? user.displayName : '◉ Cuenta';
  }
}
