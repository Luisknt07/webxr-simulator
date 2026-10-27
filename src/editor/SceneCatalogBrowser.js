import * as THREE from 'three';
import schema from '../../shared/behaviors.js';
import AssetThumbnails from './AssetThumbnails.js';
import {STUDY_SCENES, DIFFICULTY_LABELS, MODE_LABELS} from './StudySceneCatalog.js';
import {studyPreviewObject} from './StudySceneProject.js';

function node(tag, className, text) { const object = document.createElement(tag); if (className) object.className = className; if (text !== undefined) object.textContent = text; return object; }
function button(label, action, className = '') { const object = node('button', 'ed-button ' + className, label); object.type = 'button'; object.addEventListener('click', action); return object; }
function cloneGeometry(object) {
  const result = object.clone(true), materials = new Map(), geometries = new Map(), textures = new Map();
  result.traverse(part => {
    if (part.geometry) { if (!geometries.has(part.geometry)) geometries.set(part.geometry, part.geometry.clone()); part.geometry = geometries.get(part.geometry); }
    const copyMaterial = material => { if (!materials.has(material)) { const copy = material.clone(); Object.keys(copy).forEach(key => { if (copy[key] && copy[key].isTexture) { if (!textures.has(copy[key])) textures.set(copy[key], copy[key].clone()); copy[key] = textures.get(copy[key]); copy[key].needsUpdate = true; } }); materials.set(material, copy); } return materials.get(material); };
    if (part.material) part.material = Array.isArray(part.material) ? part.material.map(copyMaterial) : copyMaterial(part.material);
  });
  return result;
}

/** A complete-scene browser, separate from equipment insertion. */
export default class SceneCatalogBrowser {
  constructor(editor) { this.editor = editor; this.source = 'included'; this.query = ''; this.difficulty = ''; this.mode = ''; this.family = ''; this.busy = false; }
  open(source = 'included') {
    if (this.dialog) { this.dialog.focus(); return; }
    this.source = source; const editor = this.editor; editor.clearNavigation();
    this.previousFocus = document.activeElement;
    const dialog = node('dialog', 'ed-scene-catalog'); this.dialog = dialog; dialog.setAttribute('aria-label', 'Catálogo de escenas');
    const header = node('div', 'ed-scene-catalog-header'); const title = node('div'); title.appendChild(node('h2', '', 'Biblioteca de escenarios')); title.appendChild(node('p', '', 'Organiza tus niveles, explora ejemplos funcionales y crea escenarios desde una plantilla.')); header.appendChild(title);
    this.closeButton = button('Cerrar', () => this.close()); header.appendChild(this.closeButton); dialog.appendChild(header);
    const filters = node('div', 'ed-scene-catalog-filters'); this.sources = new Map();
    [['project', 'Mis escenarios'], ['included', 'Ejemplos incluidos'], ['templates', 'Mis plantillas']].forEach(([id, label]) => { const control = button(label, () => { this.source = id; this.render(); }); this.sources.set(id, control); filters.appendChild(control); });
    this.search = node('input'); this.search.type = 'search'; this.search.placeholder = 'Buscar escena u objetivo…'; this.search.setAttribute('aria-label', 'Buscar escenas'); this.search.value = this.query; this.search.addEventListener('input', () => { this.query = this.search.value; this.render(); }); filters.appendChild(this.search);
    const select = (label, values, value, change) => { const control = node('select'); control.setAttribute('aria-label', label); [['', label]].concat(values).forEach(([id, text]) => { const option = node('option', '', text); option.value = id; control.appendChild(option); }); control.value = value; control.addEventListener('change', () => { change(control.value); this.render(); }); filters.appendChild(control); return control; };
    this.difficultyFilter = select('Todas las dificultades', Object.entries(DIFFICULTY_LABELS), this.difficulty, value => { this.difficulty = value; });
    this.modeFilter = select('Todos los modos', Object.entries(MODE_LABELS), this.mode, value => { this.mode = value; }); dialog.appendChild(filters);
    this.familyFilter = select('Todas las categorías', Array.from(new Set(STUDY_SCENES.map(scene => scene.family))).map(value => [value, value]), this.family, value => { this.family = value; }); filters.appendChild(this.familyFilter);
    const summary = node('div', 'ed-scene-library-summary'); this.summary = summary; dialog.appendChild(summary);
    this.feedback = node('p', 'ed-scene-catalog-feedback'); this.feedback.setAttribute('aria-live', 'polite'); dialog.appendChild(this.feedback);
    this.grid = node('div', 'ed-scene-catalog-grid'); dialog.appendChild(this.grid);
    this.thumbnails = new AssetThumbnails({instantiate: descriptor => this.thumbnailObject(descriptor.path)}, this.grid);
    const footer = node('div', 'ed-scene-catalog-footer'); footer.appendChild(node('span', '', 'Hasta diez niveles por proyecto. Al crear un proyecto se aplican los permisos y la cuota de tu cuenta.'));
    footer.appendChild(button('+ Nuevo escenario', () => { this.close(); editor.studioTools.guard(() => editor.studioTools.newScene()); }, 'primary'));
    footer.appendChild(button('Otros proyectos…', () => { this.close(); editor.projectLibrary.open('levels'); })); dialog.appendChild(footer);
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('keydown', event => { event.stopPropagation(); if (event.code === 'Escape') { event.preventDefault(); this.close(); } else if (event.code === 'Tab') {
      const fields = Array.from(dialog.querySelectorAll('button,input,select')).filter(control => !control.disabled && !control.hidden); const index = fields.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0 || !event.shiftKey && index === fields.length - 1) { event.preventDefault(); if (fields.length) fields[event.shiftKey ? fields.length - 1 : 0].focus(); }
    } });
    editor.ui.appendChild(dialog); if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    this.render(); this.search.focus();
  }
  close() {
    if (this.busy || !this.dialog) return;
    this.thumbnails.dispose(); if (this.dialog.open && this.dialog.close) this.dialog.close(); this.dialog.remove(); this.dialog = null;
    if (this.previousFocus && this.previousFocus.focus) this.previousFocus.focus();
  }
  async thumbnailObject(path) {
    if (path.startsWith('included:')) return studyPreviewObject(path.slice(9));
    const roomId = path.slice(8), editor = this.editor;
    if (editor.document.hasPendingRoom(roomId)) await editor.document.activateRoom(roomId);
    const root = editor.document.getRoot(roomId), group = new THREE.Group();
    const visible = root.children.filter(object => object.visible && !object.userData.editorHelper && !object.userData.editorRuntimeHelper);
    const equipment = visible.filter(object => ['conveyor', 'source', 'processor', 'palletQueue', 'robot'].includes(object.userData.editorPrefabKey));
    (equipment.length ? equipment : visible).forEach(object => group.add(cloneGeometry(object)));
    return group;
  }
  async action(operation) {
    if (this.busy) return; this.busy = true; this.feedback.textContent = 'Preparando escenario…'; this.closeButton.disabled = true;
    this.dialog.querySelectorAll('button,input,select').forEach(control => { control.disabled = true; });
    try { const result = await operation(); this.busy = false; this.close(); return result; }
    catch (error) { this.busy = false; this.feedback.textContent = error.message || 'No se pudo preparar el escenario.'; this.dialog.querySelectorAll('button,input,select').forEach(control => { control.disabled = false; }); }
  }
  render() {
    if (!this.dialog || this.busy) return; this.thumbnails.reset(); this.grid.textContent = '';
    this.sources.forEach((control, id) => { control.setAttribute('aria-pressed', String(this.source === id)); control.classList.toggle('primary', this.source === id); });
    this.difficultyFilter.hidden = this.modeFilter.hidden = this.familyFilter.hidden = this.source !== 'included';
    const ownScenes = (this.editor.getSceneEntries ? this.editor.getSceneEntries() : schema.studio.sceneEntries(this.editor.document)).filter(scene => scene.custom || schema.studio.hasSceneContent(this.editor.document, scene.id));
    const templates = this.editor.document.studio && this.editor.document.studio.templates || [];
    this.summary.textContent = this.editor.projectName + ' · ' + ownScenes.length + ' escenarios · ' + templates.length + ' plantillas guardadas · ' + STUDY_SCENES.length + ' ejemplos del sistema';
    const text = this.query.trim().toLocaleLowerCase('es');
    if (this.source === 'project') {
      const scenes = ownScenes.filter(scene => !text || scene.name.toLocaleLowerCase('es').includes(text)).sort((a, b) => Number(b.initial) - Number(a.initial) || a.index - b.index);
      scenes.forEach(scene => this.card({id: 'project:' + scene.id, title: scene.name, description: 'Escena editable del proyecto «' + this.editor.projectName + '».', family: 'Mis escenas', tasks: [], objective: scene.initial ? 'Escenario inicial del proyecto.' : 'Abrir el nivel guardado en este proyecto.', own: scene}));
      this.feedback.textContent = scenes.length + ' escenas en este proyecto. Otros proyectos abre la biblioteca de niveles.';
    } else if (this.source === 'templates') {
      const shown = templates.filter(template => !text || template.name.toLocaleLowerCase('es').includes(text));
      shown.forEach(template => this.card({id: 'template:' + template.id, title: template.name, description: template.objects.length + ' objetos con sus propiedades, funciones y conexiones internas.', family: 'Plantillas del proyecto', tasks: [], objective: 'Insertar el conjunto en un escenario nuevo sin modificar la plantilla original.', template}));
      this.feedback.textContent = shown.length ? shown.length + ' plantillas guardadas en este proyecto.' : 'Guarda un conjunto desde Archivo → Guardar como plantilla para reutilizarlo en otros niveles.';
    } else {
      const scenes = STUDY_SCENES.filter(scene => (!this.family || scene.family === this.family) && (!this.difficulty || scene.difficulty === Number(this.difficulty)) && (!this.mode || scene.mode === this.mode) && (!text || [scene.title, scene.description, scene.objective, scene.family].join(' ').toLocaleLowerCase('es').includes(text)));
      Array.from(new Set(scenes.map(scene => scene.family))).forEach(family => {
        this.grid.appendChild(node('h3', 'ed-scene-family-heading', family));
        scenes.filter(scene => scene.family === family).sort((a, b) => a.difficulty - b.difficulty).forEach(scene => this.card(Object.assign({id: 'included:' + scene.id, presetId: scene.id}, scene, {id: 'included:' + scene.id})));
      });
      this.feedback.textContent = scenes.length + ' escenas incluidas · las variantes se crean con equipos y conexiones funcionales.';
    }
    if (!this.grid.children.length) this.grid.appendChild(node('p', 'ed-hint', 'No hay escenas con estos filtros.'));
  }
  card(scene) {
    const card = node('article', 'ed-scene-catalog-card'); card.dataset.sceneId = scene.id;
    const thumbnail = node('div', 'ed-scene-catalog-thumbnail'); card.appendChild(thumbnail);
    const body = node('div', 'ed-scene-catalog-card-body'); body.appendChild(node('span', 'ed-scene-catalog-family', scene.family)); body.appendChild(node('h3', '', scene.title));
    if (scene.difficulty) body.appendChild(node('span', 'ed-scene-catalog-badge', DIFFICULTY_LABELS[scene.difficulty] + ' · ' + MODE_LABELS[scene.mode]));
    body.appendChild(node('p', '', scene.description)); const guide = node('details', 'ed-scene-catalog-guide'); guide.appendChild(node('summary', '', 'Objetivo y guía de estudio')); guide.appendChild(node('p', '', scene.objective));
    if (scene.tasks.length) { const steps = node('ol'); scene.tasks.forEach(task => steps.appendChild(node('li', '', task))); guide.appendChild(steps); } body.appendChild(guide); card.appendChild(body);
    const actions = node('div', 'ed-scene-catalog-actions');
    if (scene.own) {
      body.appendChild(node('span', 'ed-scene-catalog-badge', scene.own.initial ? 'Escenario inicial' : 'Nivel del proyecto'));
      actions.appendChild(button(scene.own.id === this.editor.roomId ? 'Escenario actual' : 'Abrir escenario', () => this.action(async () => { await this.editor.hooks.gotoRoom(scene.own.index); this.editor.home(); return scene.own; }), 'primary'));
    } else if (scene.template) {
      thumbnail.textContent = '◇ ' + scene.template.objects.length + ' objetos'; thumbnail.classList.add('ed-scene-template-preview');
      actions.appendChild(button('Crear escenario desde plantilla', () => this.action(() => this.editor.studioTools.createTemplateScene(scene.template)), 'primary'));
      actions.appendChild(button('Insertar en el escenario actual', () => this.action(() => this.editor.studioTools.placeTemplate(scene.template))));
    }
    else {
      const full = this.editor.studioTools && !this.editor.studioTools.availableStudyRoom();
      actions.appendChild(button(full ? 'Crear en proyecto separado' : 'Crear variante editable', () => this.action(() => this.editor.studioTools.createStudyVariant(scene.presetId)), 'primary'));
      if (!full) actions.appendChild(button('Proyecto separado', () => this.action(() => this.editor.studioTools.createStudyProject([scene.presetId]))));
    }
    card.appendChild(actions); this.grid.appendChild(card);
    if (!scene.template) this.thumbnails.attach({path: scene.id, name: scene.title, kind: 'model', extension: '3d', url: scene.own ? String(this.editor.changeVersion) : String(scene.version)}, thumbnail);
  }
}
