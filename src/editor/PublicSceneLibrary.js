import {STUDY_SCENES, DIFFICULTY_LABELS, MODE_LABELS} from './StudySceneCatalog.js';

const TEMPLATE_ALIASES = {'l-transfer': 'lab-transfer-l', 'inspection-sorting': 'lab-sorting'};
const DIFFICULTIES = Object.entries(DIFFICULTY_LABELS);
const MODES = Object.entries(MODE_LABELS).concat([['explore', 'Exploración']]);
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');

/** Metadata only. Opening this library never constructs a scene or WebGL
 * preview: static thumbnails are decoded lazily by the browser. */
export function publicSceneEntry(scene, included = false) {
  const definition = (scene.included || scene.templateId) && STUDY_SCENES.find(value => value.id === (scene.templateId || TEMPLATE_ALIASES[scene.id] || scene.id));
  const original = scene.original === true;
  const category = scene.collection || definition && definition.family || (original ? 'Experiencias originales' : 'Escenarios publicados');
  const description = scene.description || definition && definition.description || (original
    ? /^panorama/.test(scene.roomId) ? 'Explora una experiencia panorámica de 360° con los controles de navegación y realidad virtual.'
      : scene.roomId === 'photogrammetry' ? 'Acércate a un modelo capturado mediante fotogrametría y observa sus detalles desde distintos puntos de vista.'
        : scene.roomId === 'sound' ? 'Descubre instrumentos y objetos sonoros en un espacio interactivo.'
          : scene.roomId === 'vertigo' ? 'Recorre una experiencia de altura con los controles del visor o del navegador.'
            : 'Recorre la galería y descubre sus objetos y experiencias interactivas.'
    : scene.id === 'industrial-lab-complete' ? 'Un laboratorio con varias líneas de transporte, clasificación, procesamiento y logística para observar sus conexiones y funcionamiento.'
      : 'Explora este escenario publicado y prueba sus equipos y controles disponibles.');
  const mode = scene.mode || definition && definition.mode || 'explore';
  return {scene, included, id: scene.id, title: scene.name || scene.title || scene.id, category, description, mode,
    difficulty: scene.difficulty || definition && definition.difficulty || 0,
    objective: scene.objective || definition && definition.objective || '', tasks: Array.isArray(scene.tasks) ? scene.tasks : definition && definition.tasks || [],
    thumbnail: !!(scene.included || scene.templateId || original),
    searchable: normalize([scene.name, scene.title, category, description, definition && definition.objective].join(' '))};
}

export default class PublicSceneLibrary {
  constructor(host, studio, entries, options = {}) {
    this.host = host; this.studio = studio; this.document = host.ownerDocument || document; this.options = options;
    this.entries = entries.map(value => publicSceneEntry(value.scene, value.included));
    this.listeners = []; this.cardListeners = []; this.images = []; this.buttons = []; this.cards = []; this.groups = []; this.busy = false; this.disposed = false;
    this.query = ''; this.category = ''; this.difficulty = ''; this.mode = '';
    this.build(); this.render();
  }
  node(tag, text, parent, className) {
    const element = this.document.createElement(tag); if (text !== undefined) element.textContent = text;
    if (className) element.className = className; if (parent) parent.appendChild(element); return element;
  }
  listen(element, event, action, cards = false) {
    element.addEventListener(event, action); (cards ? this.cardListeners : this.listeners).push(() => element.removeEventListener(event, action));
  }
  build() {
    this.host.textContent = ''; this.root = this.node('section', undefined, this.host, 'studio-scene-library');
    this.root.setAttribute('aria-label', 'Biblioteca de escenarios para explorar');
    const intro = this.node('div', undefined, this.root, 'studio-scene-library-intro');
    this.node('p', 'Elige una experiencia. Consulta su objetivo y explora los equipos y controles del escenario.', intro);
    this.node('span', 'Vista de usuario · Explorar', intro, 'studio-scene-access');
    const toolbar = this.node('div', undefined, this.root, 'studio-scene-library-filters');
    this.search = this.node('input', undefined, toolbar); this.search.type = 'search'; this.search.placeholder = 'Buscar escenario u objetivo…';
    this.search.setAttribute('aria-label', 'Buscar escenarios');
    this.listen(this.search, 'input', () => { this.query = this.search.value; this.render(); });
    const select = (label, values, change) => {
      const element = this.node('select', undefined, toolbar); element.setAttribute('aria-label', label);
      [['', label]].concat(values).forEach(([value, text]) => { this.node('option', text, element).value = value; });
      this.listen(element, 'change', () => { change(element.value); this.render(); }); return element;
    };
    this.categorySelect = select('Todas las categorías', Array.from(new Set(this.entries.map(value => value.category))).map(value => [value, value]), value => { this.category = value; });
    this.difficultySelect = select('Todos los niveles', DIFFICULTIES, value => { this.difficulty = value; });
    this.modeSelect = select('Todos los modos', MODES, value => { this.mode = value; });
    this.fields = [this.search, this.categorySelect, this.difficultySelect, this.modeSelect];
    this.feedback = this.node('p', undefined, this.root, 'studio-scene-library-feedback studio-muted'); this.feedback.setAttribute('aria-live', 'polite');
    this.results = this.node('div', undefined, this.root, 'studio-scene-library-results');
    if (this.options.requiresLogin) {
      const footer = this.node('div', undefined, this.root, 'studio-scene-library-footer');
      this.node('span', 'Inicia sesión para acceder a los demás ejemplos disponibles para tu cuenta.', footer, 'studio-muted');
      const login = this.node('button', 'Iniciar sesión', footer); login.type = 'button'; this.listen(login, 'click', () => this.studio.open('account'));
    }
  }
  filtered() {
    const query = normalize(this.query);
    return this.entries.filter(value => (!query || value.searchable.includes(query)) && (!this.category || value.category === this.category) &&
      (!this.difficulty || value.difficulty === Number(this.difficulty)) && (!this.mode || value.mode === this.mode));
  }
  clearCards() {
    this.cardListeners.splice(0).forEach(remove => remove());
    this.images.splice(0).forEach(image => image.removeAttribute('src'));
    this.buttons = []; this.cards = []; this.groups = []; this.rendered = false; if (this.results) this.results.textContent = '';
  }
  render() {
    if (this.disposed || this.busy) return;
    const entries = this.filtered();
    this.feedback.textContent = entries.length + (entries.length === 1 ? ' escenario' : ' escenarios') + ' · ' + this.entries.length + ' disponibles';
    if (!this.rendered) {
      Array.from(new Set(this.entries.map(value => value.category))).forEach(category => {
        const section = this.node('section', undefined, this.results, 'studio-scene-category');
        const title = this.node('h2', '', section, 'studio-scene-category-title'); this.groups.push({category, section, title});
        const grid = this.node('div', undefined, section, 'studio-scenes-grid'); this.entries.filter(value => value.category === category).forEach(value => this.card(value, grid));
      });
      this.empty = this.node('p', 'No hay escenarios con estos filtros. Prueba otra búsqueda o categoría.', this.results, 'studio-scene-empty'); this.rendered = true;
    }
    const shown = new Set(entries); this.cards.forEach(({entry, card}) => { card.hidden = !shown.has(entry); });
    this.groups.forEach(({category, section, title}) => { const count = entries.filter(value => value.category === category).length; section.hidden = !count; title.textContent = category + ' · ' + count; });
    this.empty.hidden = !!entries.length;
  }
  card(entry, grid) {
    const card = this.node('article', undefined, grid, 'studio-card studio-scene-card'); card.dataset.sceneId = entry.id;
    this.cards.push({entry, card});
    const preview = this.node('div', undefined, card, 'studio-scene-preview');
    const fallback = this.node('div', undefined, preview, 'studio-scene-preview-fallback');
    this.node('span', '◇', fallback); this.node('span', entry.category, fallback);
    if (entry.thumbnail && /^[a-z0-9-]{1,80}$/.test(entry.id)) {
      const image = this.node('img', undefined, preview); image.alt = 'Vista previa de ' + entry.title; image.loading = 'lazy'; image.decoding = 'async'; image.width = 640; image.height = 360;
      this.listen(image, 'load', () => { fallback.hidden = true; }, true);
      this.listen(image, 'error', () => { image.hidden = true; fallback.hidden = false; }, true);
      image.src = new URL('assets/scene-thumbnails/' + entry.id + '.png', this.document.baseURI).href; this.images.push(image);
    }
    const body = this.node('div', undefined, card, 'studio-scene-card-body');
    this.node('span', entry.category, body, 'studio-scene-card-category');
    this.node('strong', entry.title, body, 'studio-scene-card-title');
    const badges = this.node('div', undefined, body, 'studio-scene-card-badges');
    if (entry.difficulty) this.node('span', DIFFICULTY_LABELS[entry.difficulty] || '', badges);
    this.node('span', MODE_LABELS[entry.mode] || 'Exploración', badges);
    this.node('p', entry.description, body, 'studio-scene-card-description');
    if (entry.objective || entry.tasks.length) {
      const guide = this.node('details', undefined, body, 'studio-scene-card-guide'); this.node('summary', 'Objetivo y guía', guide);
      if (entry.objective) this.node('p', entry.objective, guide);
      if (entry.tasks.length) { const steps = this.node('ol', undefined, guide); entry.tasks.forEach(task => this.node('li', task, steps)); }
    }
    const current = this.options.currentId === entry.id;
    const action = this.node('button', current ? 'Continuar en este escenario' : 'Explorar escenario', card, 'studio-primary studio-scene-explore'); action.type = 'button';
    action.setAttribute('aria-label', (current ? 'Continuar en ' : 'Explorar ') + entry.title); this.buttons.push(action);
    this.listen(action, 'click', () => this.explore(entry), true);
  }
  async explore(entry) {
    if (this.disposed || this.busy || this.studio.busy) return;
    this.busy = true; this.root.setAttribute('aria-busy', 'true'); this.feedback.textContent = 'Abriendo ' + entry.title + '…';
    this.buttons.forEach(button => { button.disabled = true; });
    this.fields.forEach(field => { field.disabled = true; });
    try {
      const open = async () => {
        try { if (!this.disposed && this.options.open) return await this.options.open(entry, this); }
        catch (error) { if (!this.disposed) { this.feedback.textContent = error.message || 'No se pudo abrir el escenario.'; this.feedback.className = 'studio-scene-library-feedback studio-error'; } throw error; }
      };
      if (this.studio.guard) await this.studio.guard(open); else await open();
    } catch (_) { /* The shared studio guard presents errors; local feedback remains. */ }
    finally { if (!this.disposed) { this.busy = false; this.root.setAttribute('aria-busy', 'false'); this.buttons.forEach(button => { button.disabled = false; }); this.fields.forEach(field => { field.disabled = false; }); } }
  }
  focus() { if (!this.disposed && this.search) this.search.focus(); }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.clearCards(); this.listeners.splice(0).forEach(remove => remove());
    if (this.host) this.host.textContent = ''; this.entries = []; this.fields = []; this.options = {};
    this.host = this.root = this.results = this.search = this.studio = this.empty = this.feedback = this.categorySelect = this.difficultySelect = this.modeSelect = this.document = null;
  }
}
