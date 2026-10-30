import {PUBLIC_SCENE, loadGallery, backendOrigin, sceneURL, filterSceneEntries, DIFFICULTY_LABELS, MODE_LABELS} from './GalleryData.mjs';

function element(document, tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

export function mountGallery({document, configuration, baseURI, fetcher, onStart, workspaceURL, onAccess, onStateChange = () => {}} = {}) {
  const byId = id => document.getElementById(id), gallery = byId('gallery'), results = byId('scene-grid');
  const search = byId('scene-search'), category = byId('scene-category'), level = byId('scene-level'), mode = byId('scene-mode');
  const abort = new AbortController(), origin = backendOrigin(configuration, baseURI), listeners = [], cardListeners = [];
  const fields = [search, category, level, mode];
  let state = {scenes: [{...PUBLIC_SCENE}], user: null, backend: !!origin, unavailable: false}, busy = false, closed = false;
  let builtScenes = null, cards = [], groups = [], images = [];
  const listen = (target, type, callback, card = false) => {target.addEventListener(type, callback); (card ? cardListeners : listeners).push(() => target.removeEventListener(type, callback));};
  const access = byId('gallery-access'); access.href = workspaceURL || '#workspace-access';
  if (!workspaceURL) listen(access, 'click', event => {event.preventDefault(); onAccess();});

  function clearCards() {
    cardListeners.splice(0).forEach(off => off()); images.forEach(image => image.removeAttribute('src'));
    cards = []; groups = []; images = []; results.replaceChildren();
  }
  function categories() {
    // The menu lists the open demonstration first, then the authenticated
    // library. Keep its category/progression order in this entry point too.
    const first = state.scenes.find(scene => scene.public);
    return [...new Set((first ? [first.category] : []).concat(state.scenes.map(scene => scene.category)))];
  }
  function card(scene, grid) {
    const item = element(document, 'article', 'scene-card'); item.dataset.sceneId = scene.id;
    const preview = element(document, 'div', 'scene-card-art');
    const fallback = element(document, 'div', 'scene-preview-fallback');
    fallback.append(element(document, 'span', 'scene-preview-label', 'Vista previa'), element(document, 'p', '', scene.title));
    preview.appendChild(fallback);
    if (scene.thumbnailURL) {
      const image = element(document, 'img'); image.alt = 'Vista previa de ' + scene.title;
      image.loading = 'lazy'; image.decoding = 'async'; image.width = 480; image.height = 320;
      listen(image, 'load', () => {fallback.hidden = true;}, true);
      listen(image, 'error', () => {image.hidden = true; fallback.hidden = false; fallback.querySelector('.scene-preview-label').textContent = 'Vista previa no disponible';}, true);
      image.src = new URL(scene.thumbnailURL, baseURI).href; images.push(image); preview.appendChild(image);
    }
    if (scene.public) preview.appendChild(element(document, 'span', 'scene-badge public', 'Demostración abierta'));
    const body = element(document, 'div', 'scene-card-body');
    body.append(element(document, 'p', 'scene-collection', scene.category), element(document, 'h3', 'scene-card-title', scene.title));
    const badges = element(document, 'div', 'scene-facts');
    if (scene.difficulty) badges.appendChild(element(document, 'span', '', DIFFICULTY_LABELS[scene.difficulty]));
    badges.appendChild(element(document, 'span', '', MODE_LABELS[scene.mode] || MODE_LABELS.explore)); body.appendChild(badges);
    body.appendChild(element(document, 'p', 'scene-card-description', scene.description));
    if (scene.objective || scene.tasks.length) {
      const guide = element(document, 'details', 'scene-card-guide'); guide.appendChild(element(document, 'summary', '', 'Objetivo y guía'));
      if (scene.objective) guide.appendChild(element(document, 'p', 'scene-card-objective', scene.objective));
      if (scene.tasks.length) {const steps = element(document, 'ol'); scene.tasks.forEach(task => steps.appendChild(element(document, 'li', '', task))); guide.appendChild(steps);}
      body.appendChild(guide);
    }
    const target = sceneURL(scene, origin, !!state.user), action = element(document, target ? 'a' : 'button', 'scene-open', 'Explorar escenario');
    action.dataset.sceneId = scene.id; action.setAttribute('aria-label', 'Explorar ' + scene.title);
    if (target) {action.href = target; listen(action, 'click', event => {if (busy) event.preventDefault();}, true);}
    else {
      action.type = 'button';
      listen(action, 'click', async () => {
        if (busy || closed) return; busy = true; render();
        try {await onStart(scene);} catch (error) {byId('gallery-status').textContent = error && error.message || 'No se pudo abrir el escenario. Vuelve a intentarlo.';}
        finally {busy = false; if (!closed) render();}
      }, true);
    }
    item.append(preview, body, action); grid.appendChild(item); cards.push({scene, item, action});
  }
  function buildCards() {
    clearCards();
    categories().forEach((name, index) => {
      const section = element(document, 'section', 'scene-group'), title = element(document, 'h2', 'scene-group-title scene-category-title');
      title.id = 'scene-group-' + index; section.setAttribute('aria-labelledby', title.id);
      const grid = element(document, 'div', 'scene-group-grid'); section.append(title, grid); results.appendChild(section);
      state.scenes.filter(scene => scene.category === name).forEach(scene => card(scene, grid)); groups.push({name, section, title});
    });
    builtScenes = state.scenes;
  }
  function filtered() {return filterSceneEntries(state.scenes, {query: search.value, category: category.value, difficulty: level.value, mode: mode.value});}
  function render() {
    if (closed) return;
    if (builtScenes !== state.scenes) buildCards();
    const matches = filtered(), shown = new Set(matches);
    cards.forEach(({scene, item, action}) => {
      item.hidden = !shown.has(scene);
      if (action.tagName === 'BUTTON') action.disabled = busy;
      else {action.setAttribute('aria-disabled', String(busy)); action.tabIndex = busy ? -1 : 0;}
    });
    groups.forEach(({name, section, title}) => {const count = matches.filter(scene => scene.category === name).length; section.hidden = count === 0; title.textContent = name + ' · ' + count;});
    fields.forEach(field => {field.disabled = busy;});
    byId('gallery-empty').hidden = matches.length > 0;
    byId('scene-count').textContent = matches.length + (matches.length === 1 ? ' escenario' : ' escenarios') + ' · ' + state.scenes.length + ' disponibles';
    byId('gallery-session').textContent = state.user ? 'Sesión de ' + state.user.name : 'Explora una demostración abierta';
    byId('gallery-access-note').hidden = !!state.user;
    byId('gallery-access').textContent = state.user ? 'Abrir mi espacio' : 'Iniciar sesión';
    if (state.user && origin) {byId('gallery-access').href = new URL('/editor', origin).href; byId('workspace-link').href = new URL('/editor', origin).href; byId('workspace-link').textContent = 'Mi espacio ↗';}
  }
  function options(field, label, values) {
    const previous = field.value; field.replaceChildren(); const all = element(document, 'option', '', label); all.value = ''; field.appendChild(all);
    values.forEach(([value, text]) => {const option = element(document, 'option', '', text); option.value = value; field.appendChild(option);});
    if ([...field.options].some(option => option.value === previous)) field.value = previous;
  }
  function collections() {options(category, 'Todas las categorías', categories().map(name => [name, name]));}
  function show({focus = true} = {}) {if (closed) return; gallery.hidden = false; document.body.classList.add('gallery-open'); document.body.classList.remove('scene-active','ready','driving','immersive'); byId('loading').hidden = true; if (focus) byId('gallery-title').focus({preventScroll: true});}
  fields.forEach(field => listen(field, field === search ? 'input' : 'change', render));
  options(level, 'Todos los niveles', Object.entries(DIFFICULTY_LABELS)); options(mode, 'Todos los modos', Object.entries(MODE_LABELS));
  collections(); render(); onStateChange(state);
  const ready = loadGallery({configuration, baseURI, fetcher, signal: abort.signal}).then(value => {
    if (closed) return; state = value; collections(); render(); onStateChange(state); results.setAttribute('aria-busy', 'false');
    byId('gallery-status').textContent = state.unavailable ? 'No se pudo actualizar la biblioteca. La demostración sigue disponible; vuelve a cargar para reintentar.' : state.user ? 'Consulta el objetivo y la guía de cada práctica antes de abrirla en tu espacio.' : 'Elige la demostración o inicia sesión para ver más escenarios.';
  }).catch(() => {if (!closed) {results.setAttribute('aria-busy', 'false'); byId('gallery-status').textContent = 'No se pudo actualizar la biblioteca. Vuelve a cargar para reintentar.';}});
  return Object.freeze({ready, show, hide() {gallery.hidden = true; document.body.classList.remove('gallery-open');},
    setStatus(message) {byId('gallery-status').textContent = message;},
    getStats: () => ({sceneIds: state.scenes.map(scene => scene.id), visibleSceneIds: filtered().map(scene => scene.id), authenticated: !!state.user, backend: state.backend, busy, visible: !gallery.hidden}),
    dispose() {closed = true; abort.abort(); listeners.splice(0).forEach(off => off()); clearCards();}});
}
