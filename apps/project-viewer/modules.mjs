import {cloneData, validateProject, validateState, fail, plain} from '../../packages/contracts/index.js';

/** Import data only. The installed catalog, capabilities and local code are
 * supplied by the application and cannot be changed by a project file. */
export function parseSessionDocument(text) {
  if (typeof text !== 'string' || text.length > 16000000) fail('data_limit', 'El archivo de proyecto es demasiado grande.');
  const value = cloneData(JSON.parse(text));
  if (!plain(value)) fail('invalid_project', 'El archivo debe contener un proyecto o una sesión válida.');
  if (value.format === 'smarttwin.project-session') {
    if (value.version !== 1) fail('invalid_project', 'Versión de sesión no compatible.');
    const project = validateProject(value.project), state = value.state == null ? null : validateState(value.state);
    if (state && state.worldId !== project.worldId) fail('world_mismatch', 'El estado pertenece a otro proyecto.');
    return {project, settings: {state, pausedModules: value.pausedModules === undefined ? [] : value.pausedModules, allowOptionalMissing: value.allowOptionalMissing === undefined ? false : value.allowOptionalMissing}};
  }
  return {project: validateProject(value), settings: {allowOptionalMissing: true}};
}

export function renderModuleManager({document, parent, session, onError = () => {}}) {
  const root = document.createElement('section'); root.className = 'module-manager'; parent.appendChild(root);
  let cleanup = [], disposed = false;
  const clear = () => {cleanup.splice(0).forEach(off => off()); while (root.firstChild) root.removeChild(root.firstChild);};
  const draw = state => {
    if (disposed) return; clear();
    const add = (tag, text, target = root) => {const node = document.createElement(tag); node.textContent = text; target.appendChild(node); return node;};
    const button = (label, target, action, disabled = false) => {
      const node = add('button', label, target); node.type = 'button'; node.disabled = state.busy || disabled;
      const click = async () => {if (disposed || node.disabled) return; try {await action();} catch (error) {if (!disposed) onError(error);} };
      node.addEventListener('click', click); cleanup.push(() => node.removeEventListener('click', click)); return node;
    };
    add('h2', 'Módulos del proyecto');
    add('p', 'Pausar conserva recursos. Desactivar libera funciones sin borrar sus datos. Las dependencias compartidas permanecen mientras otro módulo las necesite.').className = 'scope-note';
    for (const available of state.availableModules) {
      const selected = state.modules.find(module => module.id === available.id), core = state.core;
      const running = core && core.functions || [], active = selected && ['active','paused'].includes(selected.status);
      const card = add('article', ''); card.className = 'module-card'; card.dataset.moduleId = available.id;
      add('h3', available.title, card); add('code', available.id, card);
      const shared = !active && available.functions.some(fn => running.some(entry => entry.id === fn.id));
      const status = shared ? 'Compartido en uso' : !selected ? 'Fuera del proyecto' : selected.status === 'active' ? 'Activo' : selected.status === 'paused' ? 'En pausa' : selected.status === 'disabled' ? 'Desactivado' : 'Sin funciones activas';
      add('p', status, card).className = 'module-state';
      const actions = add('div', '', card); actions.className = 'command-actions';
      if (active) {
        button(selected.status === 'paused' ? 'Continuar' : 'Pausar', actions, () => selected.status === 'paused' ? session.resumeModule(available.id) : session.pauseModule(available.id), selected.hotPause === false);
        button('Desactivar', actions, () => session.disableModule(available.id), selected.hotRemoval === false);
      } else button(selected ? 'Activar' : 'Añadir', actions, () => session.enableModule(available.id));
      if (selected) button('Quitar del proyecto', actions, () => session.removeModule(available.id), selected.hotRemoval === false);
      for (const fn of available.functions) {
        const label = add('label', '', card); label.className = 'function-toggle';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; label.appendChild(checkbox);
        const reference = selected && selected.functions.find(item => (typeof item === 'string' ? item : item.id) === fn.id);
        checkbox.checked = !!reference && (typeof reference === 'string' || reference.enabled !== false);
        checkbox.disabled = state.busy || !selected || selected.enabled === false || selected.hotRemoval === false;
        const dependent = !checkbox.checked && running.some(entry => entry.id === fn.id);
        add('span', fn.title + (dependent ? ' · necesaria como dependencia' : ''), label);
        const change = async () => {if (disposed || checkbox.disabled) return; try {await session.setFunctionEnabled(available.id, fn.id, checkbox.checked);} catch (error) {if (!disposed) {onError(error); draw(session.status());}}};
        checkbox.addEventListener('change', change); cleanup.push(() => checkbox.removeEventListener('change', change));
      }
    }
    for (const module of state.modules.filter(row => !row.installed)) {
      const card = add('article', ''); card.className = 'module-card';
      add('p', module.id + ' · no está incluido en esta distribución; sus datos se conservan.', card).className = 'scope-note';
      button('Quitar referencia', card, () => session.removeModule(module.id));
    }
    add('p', 'Solo se pueden activar funciones incluidas al compilar esta distribución. Para incorporar un paquete nuevo, añádelo a modules/ y vuelve a compilar su proyecto.').className = 'scope-note';
  };
  const unsubscribe = session.subscribe(draw);
  return () => {disposed = true; unsubscribe(); clear(); root.remove();};
}

export function mountProjectTransfer({document, window, parent, session, onError = () => {}}) {
  const root = document.createElement('div'); root.className = 'project-transfer'; parent.appendChild(root);
  const open = document.createElement('button'), save = document.createElement('button'), input = document.createElement('input');
  open.textContent = 'Abrir proyecto'; save.textContent = 'Descargar proyecto y estado'; open.type = save.type = 'button';
  input.type = 'file'; input.accept = 'application/json,.json'; input.hidden = true; root.append(open, save, input);
  let disposed = false, loading = false; const urls = new Set(), timers = new Set();
  const report = error => {if (!disposed) onError(error);};
  const choose = () => input.click();
  const load = async () => {
    const file = input.files && input.files[0]; if (!file || loading || session.busy) return;
    loading = true; open.disabled = save.disabled = true;
    try {
      if (file.size > 16000000) throw new Error('El proyecto supera el límite de 16 MB.');
      const data = parseSessionDocument(await file.text()); if (disposed) return;
      await session.open(data.project, data.settings);
    } catch (error) {report(error);} finally {loading = false; input.value = ''; if (!disposed) {open.disabled = session.busy; save.disabled = session.busy || !session.project;}}
  };
  const download = () => {
    try {
      const snapshot = session.capture(); if (!snapshot) return;
      const bytes = JSON.stringify({format:'smarttwin.project-session',version:1,...snapshot}, null, 2);
      const url = window.URL.createObjectURL(new window.Blob([bytes], {type:'application/json'})); urls.add(url);
      const link = document.createElement('a'); link.href = url; link.download = 'proyecto-modular.json'; root.appendChild(link); link.click(); link.remove();
      const timer = window.setTimeout(() => {timers.delete(timer); if (urls.delete(url)) window.URL.revokeObjectURL(url);}, 1000); timers.add(timer);
    } catch (error) {report(error);}
  };
  open.addEventListener('click', choose); save.addEventListener('click', download); input.addEventListener('change', load);
  const unsubscribe = session.subscribe(state => {open.disabled = loading || state.busy; save.disabled = loading || state.busy || !state.project;});
  return () => {disposed = true; unsubscribe(); open.removeEventListener('click', choose); save.removeEventListener('click', download); input.removeEventListener('change', load); for (const timer of timers) if (window.clearTimeout) window.clearTimeout(timer); timers.clear(); for (const url of urls) window.URL.revokeObjectURL(url); urls.clear(); root.remove();};
}
