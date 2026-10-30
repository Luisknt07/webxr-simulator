// Pure display metadata shared by the startup gallery and the in-world menu.
// This catalogue imports descriptions only, never builders, models or editor UI.
import {STUDY_SCENES, DIFFICULTY_LABELS as STUDY_DIFFICULTY_LABELS, MODE_LABELS as STUDY_MODE_LABELS} from '../../modules/logistica-industrial/scenarios/StudySceneCatalog.js';

export const DIFFICULTY_LABELS = Object.freeze({...STUDY_DIFFICULTY_LABELS});
export const MODE_LABELS = Object.freeze({...STUDY_MODE_LABELS, explore: 'Exploración'});
const TEMPLATE_ALIASES = {'l-transfer': 'lab-transfer-l', 'inspection-sorting': 'lab-sorting'};
const text = (value, fallback = '', maximum = 160) => typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : fallback;
export const normalizeSceneSearch = value => text(value, '', 20000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');

export function publicSceneEntry(input, included = false) {
  const scene = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const id = text(scene.id, '', 80), templateId = text(scene.templateId, '', 80), roomId = text(scene.roomId, '', 80);
  const definition = (scene.included === true || templateId) && STUDY_SCENES.find(value => value.id === (templateId || TEMPLATE_ALIASES[id] || id));
  const original = scene.original === true;
  const category = text(scene.collection, definition && definition.family || (original ? 'Experiencias originales' : 'Escenarios publicados'), 100);
  const description = text(scene.description, definition && definition.description || (original
    ? /^panorama/.test(roomId) ? 'Explora una experiencia panorámica de 360° con los controles de navegación y realidad virtual.'
      : roomId === 'photogrammetry' ? 'Acércate a un modelo capturado mediante fotogrametría y observa sus detalles desde distintos puntos de vista.'
        : roomId === 'sound' ? 'Descubre instrumentos y objetos sonoros en un espacio interactivo.'
          : roomId === 'vertigo' ? 'Recorre una experiencia de altura con los controles del visor o del navegador.'
            : 'Recorre la galería y descubre sus objetos y experiencias interactivas.'
    : id === 'industrial-lab-complete' ? 'Un laboratorio con varias líneas de transporte, clasificación, procesamiento y logística para observar sus conexiones y funcionamiento.'
      : 'Explora este escenario publicado y prueba sus equipos y controles disponibles.'), 2400);
  const mode = typeof scene.mode === 'string' && Object.prototype.hasOwnProperty.call(MODE_LABELS, scene.mode) ? scene.mode : definition && definition.mode || 'explore';
  const difficulty = [0, 1, 2, 3].includes(scene.difficulty) ? scene.difficulty : definition && definition.difficulty || 0;
  const objective = text(scene.objective, definition && definition.objective || '', 1600);
  const tasks = (Array.isArray(scene.tasks) ? scene.tasks : definition && definition.tasks || []).filter(value => typeof value === 'string' && value.trim()).slice(0, 16).map(value => value.trim().slice(0, 700));
  const title = text(scene.name, text(scene.title, definition && definition.title || id || 'Escenario'), 200);
  return {scene, included, id, title, category, description, mode, difficulty, objective, tasks,
    thumbnail: /^[a-z0-9][a-z0-9-]{0,79}$/.test(id) && !!(scene.included === true || templateId || original),
    searchable: normalizeSceneSearch([title, category, description, objective, ...tasks].join(' '))};
}

export function filterSceneEntries(entries, {query = '', category = '', difficulty = '', mode = ''} = {}) {
  const search = normalizeSceneSearch(query);
  return entries.filter(entry => (!search || entry.searchable.includes(search)) && (!category || entry.category === category) &&
    (difficulty === '' || entry.difficulty === Number(difficulty)) && (!mode || entry.mode === mode));
}
